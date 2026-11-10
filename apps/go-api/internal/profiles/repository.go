package profiles

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/my-better-t-app/go-api/internal/store"
)

const pgUniqueViolation = "23505"

// Repository implements profile reads and writes on top of sqlc queries.
type Repository struct {
	queries *store.Queries
	now     func() time.Time
	newID   func() string
}

// NewRepository builds a Repository over a pgx pool, connection or transaction.
func NewRepository(db store.DBTX) *Repository {
	return &Repository{queries: store.New(db), now: time.Now, newID: newID}
}

// newID returns a 25-character lowercase id starting with "c", the same shape
// as the cuid ids Prisma generates, so both writers produce look-alike keys.
func newID() string {
	return "c" + strings.ToLower(rand.Text())[:24]
}

// Get returns one profile or ErrNotFound.
func (r *Repository) Get(ctx context.Context, id string) (Profile, error) {
	row, err := r.queries.GetProfile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	return fromRow(row), nil
}

// List returns one page ordered by <sort> DESC, id DESC. A cursor whose row
// no longer exists restarts from the first page, like the tRPC procedure.
func (r *Repository) List(ctx context.Context, params ListParams) (Page, error) {
	pattern := containsPattern(params.Keyword)
	// Fetch one extra row to learn whether another page exists.
	limit := int32(params.Limit + 1)

	var cursor *store.GetProfileCursorRow
	if params.Cursor != "" {
		row, err := r.queries.GetProfileCursor(ctx, params.Cursor)
		switch {
		case err == nil:
			cursor = &row
		case !errors.Is(err, pgx.ErrNoRows):
			return Page{}, err
		}
	}

	rows, err := r.listRows(ctx, params.Sort, pattern, cursor, limit)
	if err != nil {
		return Page{}, err
	}
	total, err := r.queries.CountProfiles(ctx, pattern)
	if err != nil {
		return Page{}, err
	}

	hasMore := len(rows) > params.Limit
	if hasMore {
		rows = rows[:params.Limit]
	}
	items := make([]Profile, len(rows))
	for i, row := range rows {
		items[i] = fromRow(row)
	}
	page := Page{Items: items, Total: total}
	if hasMore {
		page.NextCursor = &items[len(items)-1].ID
	}
	return page, nil
}

func (r *Repository) listRows(
	ctx context.Context, sort Sort, pattern string, cursor *store.GetProfileCursorRow, limit int32,
) ([]store.GithubProfile, error) {
	var cursorID *string
	if cursor != nil {
		cursorID = &cursor.ID
	}
	switch sort {
	case SortFollowers:
		params := store.ListProfilesByFollowersParams{Pattern: pattern, CursorID: cursorID, RowLimit: limit}
		if cursor != nil {
			params.CursorFollowers = &cursor.Followers
		}
		return r.queries.ListProfilesByFollowers(ctx, params)
	case SortPublicRepos:
		params := store.ListProfilesByPublicReposParams{Pattern: pattern, CursorID: cursorID, RowLimit: limit}
		if cursor != nil {
			params.CursorPublicRepos = &cursor.PublicRepos
		}
		return r.queries.ListProfilesByPublicRepos(ctx, params)
	default:
		params := store.ListProfilesByCreatedAtParams{Pattern: pattern, CursorID: cursorID, RowLimit: limit}
		if cursor != nil {
			params.CursorCreatedAt = &cursor.CreatedAt
		}
		return r.queries.ListProfilesByCreatedAt(ctx, params)
	}
}

// Create inserts a profile; the input must already be normalized. Returns
// ErrDuplicate when the githubId is already in the system.
func (r *Repository) Create(ctx context.Context, input NewProfile) (Profile, error) {
	// Columns are TIMESTAMP(3) without time zone holding UTC, as Prisma writes them.
	now := r.now().UTC().Truncate(time.Millisecond)
	tags := input.Tags
	if tags == nil {
		tags = []string{}
	}
	row, err := r.queries.InsertProfile(ctx, store.InsertProfileParams{
		ID:              r.newID(),
		GithubId:        int32(input.GithubID),
		Login:           input.Login,
		Name:            input.Name,
		Bio:             input.Bio,
		Company:         input.Company,
		Location:        input.Location,
		Blog:            input.Blog,
		TwitterUsername: input.TwitterUsername,
		AvatarUrl:       input.AvatarURL,
		HtmlUrl:         input.HTMLURL,
		PublicRepos:     int32(input.PublicRepos),
		Followers:       int32(input.Followers),
		Following:       int32(input.Following),
		GithubCreatedAt: input.GithubCreatedAt.UTC().Truncate(time.Millisecond),
		Note:            input.Note,
		Tags:            tags,
		SyncedAt:        now,
		CreatedAt:       now,
		UpdatedAt:       now,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
		return Profile{}, ErrDuplicate
	}
	if err != nil {
		return Profile{}, err
	}
	return fromRow(row), nil
}

func fromRow(row store.GithubProfile) Profile {
	tags := row.Tags
	if tags == nil {
		tags = []string{}
	}
	return Profile{
		ID:              row.ID,
		GithubID:        row.GithubId,
		Login:           row.Login,
		Name:            row.Name,
		Bio:             row.Bio,
		Company:         row.Company,
		Location:        row.Location,
		Blog:            row.Blog,
		TwitterUsername: row.TwitterUsername,
		AvatarURL:       row.AvatarUrl,
		HTMLURL:         row.HtmlUrl,
		PublicRepos:     row.PublicRepos,
		Followers:       row.Followers,
		Following:       row.Following,
		GithubCreatedAt: row.GithubCreatedAt.UTC(),
		Note:            row.Note,
		Tags:            tags,
		SyncedAt:        row.SyncedAt.UTC(),
		CreatedAt:       row.CreatedAt.UTC(),
		UpdatedAt:       row.UpdatedAt.UTC(),
	}
}
