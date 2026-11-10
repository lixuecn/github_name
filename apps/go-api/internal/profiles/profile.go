// Package profiles reads and writes rows of the github_profile table, which is
// owned by the Prisma schema in packages/db.
package profiles

import (
	"errors"
	"time"
)

// Sort selects the list ordering; values match the tRPC github.list input.
type Sort string

const (
	SortCreatedAt   Sort = "createdAt"
	SortFollowers   Sort = "followers"
	SortPublicRepos Sort = "publicRepos"
)

// Valid reports whether s is a supported sort.
func (s Sort) Valid() bool {
	switch s {
	case SortCreatedAt, SortFollowers, SortPublicRepos:
		return true
	default:
		return false
	}
}

const (
	DefaultPageSize  = 20
	MaxPageSize      = 50
	MaxKeywordLength = 100
)

var (
	ErrNotFound  = errors.New("profile not found")
	ErrDuplicate = errors.New("profile with this githubId already exists")
)

// Profile is the API representation of a github_profile row.
type Profile struct {
	ID              string    `json:"id"`
	GithubID        int32     `json:"githubId"`
	Login           string    `json:"login"`
	Name            *string   `json:"name"`
	Bio             *string   `json:"bio"`
	Company         *string   `json:"company"`
	Location        *string   `json:"location"`
	Blog            *string   `json:"blog"`
	TwitterUsername *string   `json:"twitterUsername"`
	AvatarURL       string    `json:"avatarUrl"`
	HTMLURL         string    `json:"htmlUrl"`
	PublicRepos     int32     `json:"publicRepos"`
	Followers       int32     `json:"followers"`
	Following       int32     `json:"following"`
	GithubCreatedAt time.Time `json:"githubCreatedAt"`
	Note            *string   `json:"note"`
	Tags            []string  `json:"tags"`
	SyncedAt        time.Time `json:"syncedAt"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// ListParams filters and paginates the profile list.
type ListParams struct {
	Keyword string
	Sort    Sort
	Cursor  string
	Limit   int
}

// Page is one page of profiles plus the total count matching the filter.
type Page struct {
	Items      []Profile `json:"items"`
	Total      int64     `json:"total"`
	NextCursor *string   `json:"nextCursor"`
}
