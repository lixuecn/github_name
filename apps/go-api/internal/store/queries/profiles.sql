-- Ordering matches the tRPC github.list procedure: <sort column> DESC, id DESC.
-- Keyset pagination: rows strictly after the cursor row in that order.
-- An empty @pattern disables the keyword filter; otherwise it is an ILIKE pattern.

-- name: GetProfile :one
SELECT * FROM github_profile WHERE id = $1;

-- name: GetProfileCursor :one
SELECT id, "createdAt", followers, "publicRepos" FROM github_profile WHERE id = $1;

-- name: CountProfiles :one
SELECT count(*) FROM github_profile
WHERE sqlc.arg(pattern)::text = ''
   OR login ILIKE sqlc.arg(pattern)
   OR name ILIKE sqlc.arg(pattern)
   OR note ILIKE sqlc.arg(pattern);

-- name: ListProfilesByCreatedAt :many
SELECT * FROM github_profile
WHERE (sqlc.arg(pattern)::text = ''
       OR login ILIKE sqlc.arg(pattern)
       OR name ILIKE sqlc.arg(pattern)
       OR note ILIKE sqlc.arg(pattern))
  AND (sqlc.narg(cursor_id)::text IS NULL
       OR ("createdAt", id) < (sqlc.narg(cursor_created_at)::timestamp, sqlc.narg(cursor_id)::text))
ORDER BY "createdAt" DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: ListProfilesByFollowers :many
SELECT * FROM github_profile
WHERE (sqlc.arg(pattern)::text = ''
       OR login ILIKE sqlc.arg(pattern)
       OR name ILIKE sqlc.arg(pattern)
       OR note ILIKE sqlc.arg(pattern))
  AND (sqlc.narg(cursor_id)::text IS NULL
       OR (followers, id) < (sqlc.narg(cursor_followers)::integer, sqlc.narg(cursor_id)::text))
ORDER BY followers DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: ListProfilesByPublicRepos :many
SELECT * FROM github_profile
WHERE (sqlc.arg(pattern)::text = ''
       OR login ILIKE sqlc.arg(pattern)
       OR name ILIKE sqlc.arg(pattern)
       OR note ILIKE sqlc.arg(pattern))
  AND (sqlc.narg(cursor_id)::text IS NULL
       OR ("publicRepos", id) < (sqlc.narg(cursor_public_repos)::integer, sqlc.narg(cursor_id)::text))
ORDER BY "publicRepos" DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: InsertProfile :one
INSERT INTO github_profile (
  id, "githubId", login, name, bio, company, location, blog, "twitterUsername",
  "avatarUrl", "htmlUrl", "publicRepos", followers, following, "githubCreatedAt",
  note, tags, "syncedAt", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, $11, $12, $13, $14, $15,
  $16, $17, $18, $19, $20
)
RETURNING *;
