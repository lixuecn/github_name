package profiles

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

func validInput() NewProfile {
	return NewProfile{
		GithubID:        1024025,
		Login:           "torvalds",
		AvatarURL:       "https://avatars.githubusercontent.com/u/1024025?v=4",
		HTMLURL:         "https://github.com/torvalds",
		PublicRepos:     8,
		Followers:       230000,
		GithubCreatedAt: time.Date(2011, 9, 3, 15, 26, 22, 0, time.UTC),
	}
}

func ptr[T any](v T) *T { return &v }

func TestNormalizeAcceptsValidInput(t *testing.T) {
	input := validInput()
	input.Login = "  torvalds  "
	input.Note = ptr("  内核作者  ")
	input.Tags = []string{" 后端 ", "", "后端", "C"}

	if err := input.Normalize(); err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if input.Login != "torvalds" {
		t.Errorf("Login = %q, want trimmed", input.Login)
	}
	if input.Note == nil || *input.Note != "内核作者" {
		t.Errorf("Note = %v, want trimmed", input.Note)
	}
	if want := []string{"后端", "C"}; !slices.Equal(input.Tags, want) {
		t.Errorf("Tags = %q, want %q", input.Tags, want)
	}
}

func TestNormalizeEmptyNoteBecomesNil(t *testing.T) {
	input := validInput()
	input.Note = ptr("   ")
	if err := input.Normalize(); err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if input.Note != nil {
		t.Errorf("Note = %q, want nil", *input.Note)
	}
	if input.Tags == nil {
		t.Error("Tags = nil, want empty slice")
	}
}

func TestNormalizeRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NewProfile)
		want   string
	}{
		{"zero githubId", func(n *NewProfile) { n.GithubID = 0 }, "githubId"},
		{"githubId overflows INTEGER", func(n *NewProfile) { n.GithubID = 1 << 31 }, "githubId"},
		{"login with leading hyphen", func(n *NewProfile) { n.Login = "-bad" }, "用户名格式不正确"},
		{"login too long", func(n *NewProfile) { n.Login = strings.Repeat("a", 40) }, "用户名格式不正确"},
		{"avatarUrl not http", func(n *NewProfile) { n.AvatarURL = "javascript:alert(1)" }, "avatarUrl"},
		{"htmlUrl empty", func(n *NewProfile) { n.HTMLURL = "" }, "htmlUrl"},
		{"negative followers", func(n *NewProfile) { n.Followers = -1 }, "followers"},
		{"missing githubCreatedAt", func(n *NewProfile) { n.GithubCreatedAt = time.Time{} }, "githubCreatedAt"},
		{"note too long", func(n *NewProfile) { n.Note = ptr(strings.Repeat("字", NoteMaxLength+1)) }, "备注"},
		{"too many tags", func(n *NewProfile) { n.Tags = []string{"a", "b", "c", "d", "e", "f"} }, "标签最多"},
		{"tag too long", func(n *NewProfile) { n.Tags = []string{strings.Repeat("标", TagMaxLength+1)} }, "每个标签"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := validInput()
			tt.mutate(&input)
			err := input.Normalize()
			var validationErr *ValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("Normalize() error = %v, want ValidationError", err)
			}
			if !strings.Contains(validationErr.Message, tt.want) {
				t.Errorf("message = %q, want it to contain %q", validationErr.Message, tt.want)
			}
		})
	}
}

func TestNormalizeAllowsMaxLengths(t *testing.T) {
	input := validInput()
	input.Note = ptr(strings.Repeat("字", NoteMaxLength))
	input.Tags = []string{strings.Repeat("标", TagMaxLength), "b", "c", "d", "e"}
	if err := input.Normalize(); err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
}

func TestContainsPatternEscapesWildcards(t *testing.T) {
	tests := map[string]string{
		"":         "",
		"tor":      "%tor%",
		"50%_off":  `%50\%\_off%`,
		`back\sla`: `%back\\sla%`,
	}
	for keyword, want := range tests {
		if got := containsPattern(keyword); got != want {
			t.Errorf("containsPattern(%q) = %q, want %q", keyword, got, want)
		}
	}
}

func TestNewIDShape(t *testing.T) {
	id := newID()
	if len(id) != 25 || id[0] != 'c' || strings.ToLower(id) != id {
		t.Errorf("newID() = %q, want 25 lowercase chars starting with c", id)
	}
	if newID() == id {
		t.Error("newID() returned the same id twice")
	}
}
