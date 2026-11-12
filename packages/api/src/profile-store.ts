import type { Database, GithubProfile } from "@my-better-t-app/db";
import { z } from "zod";

import type { GithubUser } from "./github-client";
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

/** The GitHub-owned columns (everything a sync overwrites). */
export type GithubProfileData = Omit<GithubUser, "githubId">;

export type NewProfileData = GithubUser & { note: string | null };

/** Partial update of the system-owned fields; an absent key is left unchanged. */
export type ProfilePatch = { note?: string | null; tags?: string[] };

export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`profile ${id} not found`);
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileConflictError extends Error {
  constructor(githubId: number) {
    super(`a profile for GitHub user ${githubId} already exists`);
    this.name = "ProfileConflictError";
  }
}

/**
 * Every read and write of github_profile goes through this interface, so the
 * tRPC router does not care whether data lives behind Prisma or the Go service.
 *
 * - `list` orders by `<sort> DESC, id DESC`; a cursor whose row no longer
 *   exists restarts from the first page.
 * - `create` throws ProfileConflictError when the githubId is already present.
 * - `update`, `syncGithub` and `delete` throw ProfileNotFoundError for an unknown id.
 * - `syncGithub` overwrites GitHub fields and syncedAt, keeping note and tags.
 */
export type ProfileStore = {
  list: (input: ProfileListInput) => Promise<ProfilePage>;
  get: (id: string) => Promise<GithubProfile | null>;
  findByGithubId: (githubId: number) => Promise<GithubProfile | null>;
  create: (data: NewProfileData) => Promise<GithubProfile>;
  update: (id: string, patch: ProfilePatch) => Promise<GithubProfile>;
  syncGithub: (id: string, data: GithubProfileData) => Promise<GithubProfile>;
  delete: (id: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Prisma implementation (local development, or when GO_API_URL is unset)
// ---------------------------------------------------------------------------

const LIKE_SPECIAL_CHARS = /[\\%_]/g;

/**
 * Prisma's `contains` passes the value into ILIKE unescaped, so "%" or "_"
 * would match every row. Escape them (backslash is PostgreSQL's default LIKE
 * escape) so keywords match literally, the same as the Go service.
 */
function escapeLike(value: string): string {
  return value.replace(LIKE_SPECIAL_CHARS, "\\$&");
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

const PRISMA_UNIQUE_VIOLATION = "P2002";
const PRISMA_RECORD_MISSING = "P2025";

function githubColumns(data: GithubProfileData) {
  return {
    login: data.login,
    name: data.name,
    bio: data.bio,
    company: data.company,
    location: data.location,
    blog: data.blog,
    twitterUsername: data.twitterUsername,
    avatarUrl: data.avatarUrl,
    htmlUrl: data.htmlUrl,
    publicRepos: data.publicRepos,
    followers: data.followers,
    following: data.following,
    githubCreatedAt: data.githubCreatedAt,
  };
}

/** Reads and writes PostgreSQL directly through Prisma. */
export function createPrismaProfileStore(db: Database): ProfileStore {
  const rethrowMissing = (id: string, error: unknown): never => {
    if (hasPrismaCode(error, PRISMA_RECORD_MISSING)) {
      throw new ProfileNotFoundError(id);
    }
    throw error;
  };

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

    get: (id) => db.githubProfile.findUnique({ where: { id } }),

    findByGithubId: (githubId) => db.githubProfile.findUnique({ where: { githubId } }),

    create: async (data) => {
      try {
        return await db.githubProfile.create({
          data: {
            ...githubColumns(data),
            githubId: data.githubId,
            note: data.note,
            tags: [],
            syncedAt: new Date(),
          },
        });
      } catch (error) {
        if (hasPrismaCode(error, PRISMA_UNIQUE_VIOLATION)) {
          throw new ProfileConflictError(data.githubId);
        }
        throw error;
      }
    },

    update: async (id, patch) => {
      const data: { note?: string | null; tags?: string[] } = {};
      if (patch.note !== undefined) {
        data.note = patch.note;
      }
      if (patch.tags !== undefined) {
        data.tags = patch.tags;
      }
      try {
        return await db.githubProfile.update({ where: { id }, data });
      } catch (error) {
        return rethrowMissing(id, error);
      }
    },

    syncGithub: async (id, data) => {
      try {
        return await db.githubProfile.update({
          where: { id },
          data: { ...githubColumns(data), syncedAt: new Date() },
        });
      } catch (error) {
        return rethrowMissing(id, error);
      }
    },

    delete: async (id) => {
      try {
        await db.githubProfile.delete({ where: { id } });
      } catch (error) {
        rethrowMissing(id, error);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Go service implementation (production: GO_API_URL points at go-api)
// ---------------------------------------------------------------------------

const DEFAULT_GO_API_TIMEOUT_MS = 5000;
const TRAILING_SLASHES = /\/+$/;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

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

export type GoApiProfileStoreOptions = {
  /** e.g. http://go-api.github-name.internal:8080; no trailing path. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Reads and writes through the internal Go service (separate go-api repository). */
export function createGoApiProfileStore(options: GoApiProfileStoreOptions): ProfileStore {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GO_API_TIMEOUT_MS;
  const base = options.baseUrl.replace(TRAILING_SLASHES, "");

  /** Sends a request; resolves to the response for 2xx/404/409, else throws GoApiError. */
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GoApiError(`go-api ${method} ${path} failed`, null, { cause: error });
    }
    const expected = response.ok || response.status === HTTP_NOT_FOUND || response.status === HTTP_CONFLICT;
    if (!expected) {
      throw new GoApiError(`go-api ${method} ${path} responded ${response.status}`, response.status);
    }
    return response;
  }

  async function parse<T>(schema: z.ZodType<T, unknown>, response: Response): Promise<T> {
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new GoApiError("go-api returned an unexpected payload", response.status, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  const profilePath = (id: string) => `/profiles/${encodeURIComponent(id)}`;

  /** A single profile, or null on 404. */
  async function profileOrNull(response: Response): Promise<GithubProfile | null> {
    return response.status === HTTP_NOT_FOUND ? null : await parse(goProfileSchema, response);
  }

  /** A single profile; 404 means the id does not exist. */
  async function profileOrMissing(id: string, response: Response): Promise<GithubProfile> {
    if (response.status === HTTP_NOT_FOUND) {
      throw new ProfileNotFoundError(id);
    }
    return await parse(goProfileSchema, response);
  }

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
      const response = await send("GET", `/profiles?${params}`);
      if (!response.ok) {
        throw new GoApiError(`go-api list responded ${response.status}`, response.status);
      }
      return await parse(goPageSchema, response);
    },

    get: async (id) => profileOrNull(await send("GET", profilePath(id))),

    findByGithubId: async (githubId) =>
      profileOrNull(await send("GET", `/profiles/by-github-id/${githubId}`)),

    create: async (data) => {
      const response = await send("POST", "/profiles", { ...data, tags: [] });
      if (response.status === HTTP_CONFLICT) {
        throw new ProfileConflictError(data.githubId);
      }
      return await parse(goProfileSchema, response);
    },

    update: async (id, patch) => profileOrMissing(id, await send("PATCH", profilePath(id), patch)),

    syncGithub: async (id, data) =>
      profileOrMissing(id, await send("PUT", `${profilePath(id)}/github`, githubColumns(data))),

    delete: async (id) => {
      const response = await send("DELETE", profilePath(id));
      if (response.status === HTTP_NOT_FOUND) {
        throw new ProfileNotFoundError(id);
      }
      if (response.status !== HTTP_NO_CONTENT) {
        throw new GoApiError(`go-api delete responded ${response.status}`, response.status);
      }
    },
  };
}
