package profiles

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Limits mirror packages/api/src/shared/github.ts.
const (
	NoteMaxLength = 200
	TagsMaxCount  = 5
	TagMaxLength  = 20
)

var githubLoginPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`)

// ValidationError carries a user-facing (Chinese) message.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &ValidationError{Message: fmt.Sprintf(format, args...)}
}

// NewProfile is the input for inserting a profile. GitHub-owned fields are
// expected to come from a fresh GitHub API response fetched by the caller.
type NewProfile struct {
	GithubID        int64     `json:"githubId"`
	Login           string    `json:"login"`
	Name            *string   `json:"name"`
	Bio             *string   `json:"bio"`
	Company         *string   `json:"company"`
	Location        *string   `json:"location"`
	Blog            *string   `json:"blog"`
	TwitterUsername *string   `json:"twitterUsername"`
	AvatarURL       string    `json:"avatarUrl"`
	HTMLURL         string    `json:"htmlUrl"`
	PublicRepos     int64     `json:"publicRepos"`
	Followers       int64     `json:"followers"`
	Following       int64     `json:"following"`
	GithubCreatedAt time.Time `json:"githubCreatedAt"`
	Note            *string   `json:"note"`
	Tags            []string  `json:"tags"`
}

// Normalize validates the input in place: it trims the login, turns an empty
// note into nil, and trims, de-duplicates and drops empty tags.
func (n *NewProfile) Normalize() error {
	if n.GithubID <= 0 || n.GithubID > math.MaxInt32 {
		return invalid("githubId 必须是有效的正整数")
	}
	n.Login = strings.TrimSpace(n.Login)
	if !githubLoginPattern.MatchString(n.Login) {
		return invalid("GitHub 用户名格式不正确")
	}
	if !isHTTPURL(n.AvatarURL) {
		return invalid("avatarUrl 必须是 http(s) 链接")
	}
	if !isHTTPURL(n.HTMLURL) {
		return invalid("htmlUrl 必须是 http(s) 链接")
	}
	counts := []struct {
		field string
		value int64
	}{
		{"publicRepos", n.PublicRepos},
		{"followers", n.Followers},
		{"following", n.Following},
	}
	for _, count := range counts {
		if count.value < 0 || count.value > math.MaxInt32 {
			return invalid("%s 必须是非负整数", count.field)
		}
	}
	if n.GithubCreatedAt.IsZero() {
		return invalid("githubCreatedAt 不能为空")
	}

	note, err := normalizeNote(n.Note)
	if err != nil {
		return err
	}
	n.Note = note

	tags, err := normalizeTags(n.Tags)
	if err != nil {
		return err
	}
	n.Tags = tags
	return nil
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func normalizeNote(note *string) (*string, error) {
	if note == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*note)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > NoteMaxLength {
		return nil, invalid("备注不能超过 %d 个字", NoteMaxLength)
	}
	return &trimmed, nil
}

func normalizeTags(tags []string) ([]string, error) {
	result := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		trimmed := strings.TrimSpace(tag)
		if trimmed == "" {
			continue
		}
		if _, dup := seen[trimmed]; dup {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	for _, tag := range result {
		if utf8.RuneCountInString(tag) > TagMaxLength {
			return nil, invalid("每个标签不能超过 %d 个字", TagMaxLength)
		}
	}
	if len(result) > TagsMaxCount {
		return nil, invalid("标签最多 %d 个", TagsMaxCount)
	}
	return result, nil
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// containsPattern builds a case-insensitive "contains" ILIKE pattern; an empty
// keyword yields "" which the queries treat as "no filter".
func containsPattern(keyword string) string {
	if keyword == "" {
		return ""
	}
	return "%" + likeEscaper.Replace(keyword) + "%"
}
