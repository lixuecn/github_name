import { z } from "zod";

// Shared between server and clients: keep this file free of server-only imports.

export const NOTE_MAX_LENGTH = 200;
export const TAGS_MAX_COUNT = 5;
export const TAG_MAX_LENGTH = 20;
export const PAGE_SIZE = 20;
export const PAGE_SIZE_MAX = 50;

const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export const USERNAME_INVALID_MESSAGE = "GitHub 用户名格式不正确";

export const githubUsernameSchema = z
  .string()
  .trim()
  .regex(GITHUB_USERNAME_PATTERN, USERNAME_INVALID_MESSAGE);

/** Trimmed note; empty input becomes `null` (no note). */
export const noteSchema = z
  .string()
  .trim()
  .max(NOTE_MAX_LENGTH, `备注不能超过 ${NOTE_MAX_LENGTH} 个字`)
  .transform((value) => (value === "" ? null : value));

/** Trims each tag, drops empty and duplicate entries, then enforces limits. */
export const tagsSchema = z
  .array(z.string())
  .transform((tags) => {
    const unique = new Set<string>();
    for (const tag of tags) {
      const trimmed = tag.trim();
      if (trimmed !== "") {
        unique.add(trimmed);
      }
    }
    return [...unique];
  })
  .pipe(
    z
      .array(z.string().max(TAG_MAX_LENGTH, `每个标签不能超过 ${TAG_MAX_LENGTH} 个字`))
      .max(TAGS_MAX_COUNT, `标签最多 ${TAGS_MAX_COUNT} 个`)
  );

export const GITHUB_SORTS = ["createdAt", "followers", "publicRepos"] as const;
export type GithubSort = (typeof GITHUB_SORTS)[number];
export const githubSortSchema = z.enum(GITHUB_SORTS);

export const GITHUB_SORT_LABELS: Record<GithubSort, string> = {
  createdAt: "最新添加",
  followers: "粉丝最多",
  publicRepos: "仓库最多",
};
