package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/my-better-t-app/go-api/internal/profiles"
)

type fakeService struct {
	profile    profiles.Profile
	err        error
	listParams profiles.ListParams
	created    profiles.NewProfile
	panic      bool
}

func (f *fakeService) Get(_ context.Context, id string) (profiles.Profile, error) {
	if f.panic {
		panic("boom")
	}
	if f.err != nil {
		return profiles.Profile{}, f.err
	}
	p := f.profile
	p.ID = id
	return p, nil
}

func (f *fakeService) List(_ context.Context, params profiles.ListParams) (profiles.Page, error) {
	f.listParams = params
	if f.err != nil {
		return profiles.Page{}, f.err
	}
	return profiles.Page{Items: []profiles.Profile{f.profile}, Total: 1}, nil
}

func (f *fakeService) Create(_ context.Context, input profiles.NewProfile) (profiles.Profile, error) {
	f.created = input
	if f.err != nil {
		return profiles.Profile{}, f.err
	}
	return f.profile, nil
}

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func newTestHandler(svc *fakeService, db Pinger) http.Handler {
	return NewHandler(svc, db, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func do(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body.Error.Code
}

func TestHealthDoesNotTouchDatabase(t *testing.T) {
	h := newTestHandler(&fakeService{}, fakePinger{err: errors.New("db down")})
	if rec := do(t, h, http.MethodGet, "/health", ""); rec.Code != http.StatusOK {
		t.Fatalf("GET /health = %d, want 200", rec.Code)
	}
}

func TestReadyReflectsDatabase(t *testing.T) {
	up := newTestHandler(&fakeService{}, fakePinger{})
	if rec := do(t, up, http.MethodGet, "/ready", ""); rec.Code != http.StatusOK {
		t.Errorf("ready with db up = %d, want 200", rec.Code)
	}
	down := newTestHandler(&fakeService{}, fakePinger{err: errors.New("db down")})
	if rec := do(t, down, http.MethodGet, "/ready", ""); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("ready with db down = %d, want 503", rec.Code)
	}
}

func TestListParsesQuery(t *testing.T) {
	svc := &fakeService{}
	h := newTestHandler(svc, fakePinger{})

	rec := do(t, h, http.MethodGet, "/profiles?keyword=%20tor%20&sort=followers&limit=5&cursor=cabc", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	want := profiles.ListParams{Keyword: "tor", Sort: profiles.SortFollowers, Cursor: "cabc", Limit: 5}
	if svc.listParams != want {
		t.Errorf("params = %+v, want %+v", svc.listParams, want)
	}

	do(t, h, http.MethodGet, "/profiles", "")
	defaults := profiles.ListParams{Sort: profiles.SortCreatedAt, Limit: profiles.DefaultPageSize}
	if svc.listParams != defaults {
		t.Errorf("default params = %+v, want %+v", svc.listParams, defaults)
	}
}

func TestListRejectsBadQuery(t *testing.T) {
	h := newTestHandler(&fakeService{}, fakePinger{})
	for _, target := range []string{
		"/profiles?sort=name",
		"/profiles?limit=0",
		"/profiles?limit=51",
		"/profiles?limit=abc",
		"/profiles?keyword=" + strings.Repeat("a", profiles.MaxKeywordLength+1),
	} {
		rec := do(t, h, http.MethodGet, target, "")
		if rec.Code != http.StatusBadRequest || errorCode(t, rec) != "BAD_REQUEST" {
			t.Errorf("GET %s = %d %s, want 400 BAD_REQUEST", target, rec.Code, rec.Body)
		}
	}
}

func TestGetMapsNotFound(t *testing.T) {
	h := newTestHandler(&fakeService{err: profiles.ErrNotFound}, fakePinger{})
	rec := do(t, h, http.MethodGet, "/profiles/missing", "")
	if rec.Code != http.StatusNotFound || errorCode(t, rec) != "NOT_FOUND" {
		t.Fatalf("status = %d body %s, want 404 NOT_FOUND", rec.Code, rec.Body)
	}
}

func TestGetHidesInternalErrors(t *testing.T) {
	h := newTestHandler(&fakeService{err: errors.New("password=secret connection refused")}, fakePinger{})
	rec := do(t, h, http.MethodGet, "/profiles/x", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("response leaks internal error: %s", rec.Body)
	}
}

func TestPanicBecomes500(t *testing.T) {
	h := newTestHandler(&fakeService{panic: true}, fakePinger{})
	rec := do(t, h, http.MethodGet, "/profiles/x", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

const validBody = `{
	"githubId": 1024025,
	"login": "torvalds",
	"avatarUrl": "https://avatars.githubusercontent.com/u/1024025?v=4",
	"htmlUrl": "https://github.com/torvalds",
	"publicRepos": 8,
	"followers": 230000,
	"following": 0,
	"githubCreatedAt": "2011-09-03T15:26:22Z",
	"note": "  内核作者 ",
	"tags": ["C", "C"]
}`

func TestCreateNormalizesAndReturns201(t *testing.T) {
	svc := &fakeService{profile: profiles.Profile{ID: "c1", Login: "torvalds", Tags: []string{"C"}}}
	h := newTestHandler(svc, fakePinger{})

	rec := do(t, h, http.MethodPost, "/profiles", validBody)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body %s, want 201", rec.Code, rec.Body)
	}
	if svc.created.Note == nil || *svc.created.Note != "内核作者" || len(svc.created.Tags) != 1 {
		t.Errorf("service received unnormalized input: %+v", svc.created)
	}
	if !svc.created.GithubCreatedAt.Equal(time.Date(2011, 9, 3, 15, 26, 22, 0, time.UTC)) {
		t.Errorf("githubCreatedAt = %v", svc.created.GithubCreatedAt)
	}
	var got profiles.Profile
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.ID != "c1" {
		t.Errorf("response = %s (%v)", rec.Body, err)
	}
}

func TestCreateRejectsBadBodies(t *testing.T) {
	h := newTestHandler(&fakeService{}, fakePinger{})
	for name, body := range map[string]string{
		"not json":      `{`,
		"unknown field": `{"githubId": 1, "admin": true}`,
		"two objects":   validBody + validBody,
		"invalid login": strings.Replace(validBody, `"torvalds"`, `"-x"`, 1),
	} {
		rec := do(t, h, http.MethodPost, "/profiles", body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d body %s, want 400", name, rec.Code, rec.Body)
		}
	}
}

func TestCreateMapsDuplicate(t *testing.T) {
	h := newTestHandler(&fakeService{err: profiles.ErrDuplicate}, fakePinger{})
	rec := do(t, h, http.MethodPost, "/profiles", validBody)
	if rec.Code != http.StatusConflict || errorCode(t, rec) != "CONFLICT" {
		t.Fatalf("status = %d body %s, want 409 CONFLICT", rec.Code, rec.Body)
	}
}

func TestUnknownMethodIsRejected(t *testing.T) {
	h := newTestHandler(&fakeService{}, fakePinger{})
	if rec := do(t, h, http.MethodDelete, "/profiles/x", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE = %d, want 405", rec.Code)
	}
}
