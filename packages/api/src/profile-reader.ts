import type { Database, GithubProfile } from "@my-better-t-app/db";
import { z } from "zod";

import { GITHUB_SORTS, type GithubSort } from "./shared/github";

export type ProfileListInput = {
  /** Already trimmed; "" means no filter. */
  keyword: string;
  sort: GithubSort;
  cursor: string | null;
  limit: number;
};

export type ProfilePage = {
  items: GithubProfile[];
  total: number;
  nextCursor: string | null;
};

/**
 * Read side of the profile store. Ordering is `<sort> DESC, id DESC`; a cursor
 * whose row no longer exists restarts from the first page.
 */
export type ProfileReader = {
  list: (input: ProfileListInput) => Promise<ProfilePage>;
};

const LIKE_SPECIAL_CHARS = /[\\%_]/g;

/**
 * Prisma's `contains` passes the value into ILIKE unescaped, so "%" or "_"
 * would match every row. Escape them (backslash is PostgreSQL's default LIKE
 * escape) so keywords match literally, the same as the Go service.
 */
function escapeLike(value: string): string {
  return value.replace(LIKE_SPECIAL_CHARS, "\\$&");
}

/** Reads straight from PostgreSQL through Prisma. */
export function createPrismaProfileReader(db: Database): ProfileReader {
  return {
    list: async ({ keyword, sort, cursor, limit }) => {
      const pattern = escapeLike(keyword);
      const where = keyword
        ? {
            OR: [
              { login: { contains: pattern, mode: "insensitive" as const } },
              { name: { contains: pattern, mode: "insensitive" as const } },
              { note: { contains: pattern, mode: "insensitive" as const } },
            ],
          }
        : {};

      const cursorRow = cursor
        ? await db.githubProfile.findUnique({ where: { id: cursor }, select: { id: true } })
        : null;

      const [rows, total] = await Promise.all([
        db.githubProfile.findMany({
          where,
          orderBy: [{ [sort]: "desc" as const }, { id: "desc" as const }],
          take: limit + 1,
          ...(cursorRow ? { cursor: { id: cursorRow.id }, skip: 1 } : {}),
        }),
        db.githubProfile.count({ where }),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return { items, total, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    },
  };
}

const DEFAULT_GO_API_TIMEOUT_MS = 5000;
const TRAILING_SLASHES = /\/+$/;

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const goProfileSchema = z.object({
  id: z.string(),
  githubId: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  blog: z.string().nullable(),
  twitterUsername: z.string().nullable(),
  avatarUrl: z.string(),
  htmlUrl: z.string(),
  publicRepos: z.number().int(),
  followers: z.number().int(),
  following: z.number().int(),
  githubCreatedAt: isoDate,
  note: z.string().nullable(),
  tags: z.array(z.string()),
  syncedAt: isoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
}) satisfies z.ZodType<GithubProfile, unknown>;

const goPageSchema = z.object({
  items: z.array(goProfileSchema),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
});

export class GoApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GoApiError";
    this.status = status;
  }
}

export type GoApiProfileReaderOptions = {
  /** e.g. http://internal-go-api-alb.local; no trailing path. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Reads through the internal Go service (apps/go-api, GET /profiles). */
export function createGoApiProfileReader(options: GoApiProfileReaderOptions): ProfileReader {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GO_API_TIMEOUT_MS;
  const base = options.baseUrl.replace(TRAILING_SLASHES, "");

  return {
    list: async ({ keyword, sort, cursor, limit }) => {
      if (!GITHUB_SORTS.includes(sort)) {
        throw new GoApiError(`unsupported sort: ${sort}`, null);
      }
      const params = new URLSearchParams({ sort, limit: String(limit) });
      if (keyword) {
        params.set("keyword", keyword);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }

      let response: Response;
      try {
        response = await fetchImpl(`${base}/profiles?${params}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new GoApiError("go-api request failed", null, { cause: error });
      }
      if (!response.ok) {
        throw new GoApiError(`go-api responded ${response.status}`, response.status);
      }

      const parsed = goPageSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new GoApiError("go-api returned an unexpected payload", response.status, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    },
  };
}
