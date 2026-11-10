package profiles

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests run only when GO_API_TEST_DATABASE_URL is set. Each run
// applies the Prisma migrations inside a throwaway schema and drops it after,
// so they never touch the application's tables.
const testDatabaseEnv = "GO_API_TEST_DATABASE_URL"

func newTestRepository(t *testing.T) *Repository {
	t.Helper()
	url := os.Getenv(testDatabaseEnv)
	if url == "" {
		t.Skipf("%s not set; skipping database integration test", testDatabaseEnv)
	}
	ctx := context.Background()
	schema := fmt.Sprintf("go_api_test_%d", time.Now().UnixNano())

	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop schema: %v", err)
		}
	})

	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	applyMigrations(t, pool)

	// A ticking clock gives every insert a distinct createdAt, so the
	// createdAt ordering in assertions is deterministic.
	repo := NewRepository(pool)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	tick := 0
	repo.now = func() time.Time {
		tick++
		return start.Add(time.Duration(tick) * time.Second)
	}
	return repo
}

func applyMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	files, err := filepath.Glob("../../../../packages/db/prisma/migrations/*/migration.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no Prisma migrations found (err=%v)", err)
	}
	slices.Sort(files)
	conn, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		// Multi-statement scripts need the simple protocol.
		if _, err := conn.Conn().PgConn().Exec(context.Background(), string(sql)).ReadAll(); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
}

func insert(t *testing.T, repo *Repository, githubID int64, login string, followers, repos int64, note string) Profile {
	t.Helper()
	input := validInput()
	input.GithubID = githubID
	input.Login = login
	input.Followers = followers
	input.PublicRepos = repos
	if note != "" {
		input.Note = &note
	}
	if err := input.Normalize(); err != nil {
		t.Fatal(err)
	}
	profile, err := repo.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create(%s): %v", login, err)
	}
	return profile
}

func ids(page Page) []string {
	out := make([]string, len(page.Items))
	for i, p := range page.Items {
		out[i] = p.Login
	}
	return out
}

func TestRepositoryCreateAndGet(t *testing.T) {
	repo := newTestRepository(t)
	ctx := context.Background()

	created := insert(t, repo, 1, "torvalds", 100, 8, "内核作者")
	if created.ID == "" || created.Tags == nil || created.CreatedAt.IsZero() {
		t.Fatalf("unexpected created profile: %+v", created)
	}
	if created.CreatedAt.Location() != time.UTC || created.SyncedAt != created.CreatedAt {
		t.Errorf("timestamps = created %v synced %v, want equal UTC", created.CreatedAt, created.SyncedAt)
	}

	got, err := repo.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Login != "torvalds" || got.Note == nil || *got.Note != "内核作者" || !got.GithubCreatedAt.Equal(created.GithubCreatedAt) {
		t.Errorf("Get() = %+v", got)
	}

	if _, err := repo.Get(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get(missing) error = %v, want ErrNotFound", err)
	}

	dup := validInput()
	dup.GithubID = 1
	dup.Login = "renamed"
	if err := dup.Normalize(); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(ctx, dup); !errors.Is(err, ErrDuplicate) {
		t.Errorf("duplicate Create() error = %v, want ErrDuplicate", err)
	}
}

func TestRepositoryListSortsAndPaginates(t *testing.T) {
	repo := newTestRepository(t)
	ctx := context.Background()

	insert(t, repo, 1, "alice", 10, 3, "")
	insert(t, repo, 2, "bob", 30, 1, "")
	insert(t, repo, 3, "carol", 20, 2, "")
	insert(t, repo, 4, "dave", 20, 5, "")

	tests := []struct {
		sort Sort
		want []string
	}{
		{SortCreatedAt, []string{"dave", "carol", "bob", "alice"}},
		{SortPublicRepos, []string{"dave", "alice", "carol", "bob"}},
	}
	for _, tt := range tests {
		page, err := repo.List(ctx, ListParams{Sort: tt.sort, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if got := ids(page); !slices.Equal(got, tt.want) || page.Total != 4 || page.NextCursor != nil {
			t.Errorf("sort %s = %v total %d next %v, want %v", tt.sort, got, page.Total, page.NextCursor, tt.want)
		}
	}

	// followers has a tie (carol, dave at 20): id DESC breaks it, so walk the
	// pages and check they are exactly the full ordering with nothing repeated.
	full, err := repo.List(ctx, ListParams{Sort: SortFollowers, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	var walked []string
	cursor := ""
	for range 10 {
		page, err := repo.List(ctx, ListParams{Sort: SortFollowers, Cursor: cursor, Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		walked = append(walked, ids(page)...)
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	if !slices.Equal(walked, ids(full)) || full.Items[0].Login != "bob" || full.Items[3].Login != "alice" {
		t.Errorf("paged followers = %v, full = %v", walked, ids(full))
	}
}

func TestRepositoryListKeywordAndStaleCursor(t *testing.T) {
	repo := newTestRepository(t)
	ctx := context.Background()

	insert(t, repo, 1, "alice", 1, 1, "50%_off 客户")
	insert(t, repo, 2, "bob", 1, 1, "")
	insert(t, repo, 3, "ALICE2", 1, 1, "")

	page, err := repo.List(ctx, ListParams{Keyword: "alice", Sort: SortCreatedAt, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(page); page.Total != 2 || !slices.Equal(got, []string{"ALICE2", "alice"}) {
		t.Errorf("keyword alice = %v total %d", got, page.Total)
	}

	// Wildcards in the keyword are literal: "%_" must not match every row.
	page, err = repo.List(ctx, ListParams{Keyword: "%_", Sort: SortCreatedAt, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(page); !slices.Equal(got, []string{"alice"}) {
		t.Errorf("keyword %%_ = %v, want only the note match", got)
	}

	page, err = repo.List(ctx, ListParams{Keyword: "客户", Sort: SortCreatedAt, Limit: 10})
	if err != nil || page.Total != 1 {
		t.Errorf("note keyword: total %d err %v", page.Total, err)
	}

	page, err = repo.List(ctx, ListParams{Sort: SortCreatedAt, Cursor: "deleted-row", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(page); !slices.Equal(got, []string{"ALICE2", "bob", "alice"}) {
		t.Errorf("stale cursor returned %v, want restart from the first page", got)
	}
}
