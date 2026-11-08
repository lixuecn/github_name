const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

export type GithubUser = {
  githubId: number;
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitterUsername: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  following: number;
  githubCreatedAt: Date;
};

export type GithubErrorKind = "not_found" | "rate_limited" | "failed";

export class GithubError extends Error {
  readonly kind: GithubErrorKind;

  constructor(kind: GithubErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GithubError";
    this.kind = kind;
  }
}

export type GithubClient = {
  /** `fresh: true` skips the cached copy (and refreshes it); use it before writes. */
  getUserByLogin: (login: string, options?: { fresh?: boolean }) => Promise<GithubUser>;
  getUserById: (id: number) => Promise<GithubUser>;
};

export type GithubClientOptions = {
  token?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
};

type GithubApiUser = {
  id: number;
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter_username: string | null;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
};

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function toGithubUser(data: GithubApiUser): GithubUser {
  return {
    githubId: data.id,
    login: data.login,
    name: emptyToNull(data.name),
    bio: emptyToNull(data.bio),
    company: emptyToNull(data.company),
    location: emptyToNull(data.location),
    blog: emptyToNull(data.blog),
    twitterUsername: emptyToNull(data.twitter_username),
    avatarUrl: data.avatar_url,
    htmlUrl: data.html_url,
    publicRepos: data.public_repos,
    followers: data.followers,
    following: data.following,
    githubCreatedAt: new Date(data.created_at),
  };
}

function isRateLimited(response: Response): boolean {
  if (response.status === HTTP_TOO_MANY_REQUESTS) {
    return true;
  }
  if (response.status !== HTTP_FORBIDDEN) {
    return false;
  }
  return (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after")
  );
}

export function createGithubClient(options: GithubClientOptions = {}): GithubClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { user: GithubUser; expiresAt: number }>();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "my-better-t-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  async function request(path: string): Promise<GithubUser> {
    let response: Response;
    try {
      response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GithubError("failed", "GitHub request failed", { cause: error });
    }

    if (response.status === HTTP_NOT_FOUND) {
      throw new GithubError("not_found", "GitHub user not found");
    }
    if (isRateLimited(response)) {
      throw new GithubError("rate_limited", "GitHub rate limit exceeded");
    }
    if (!response.ok) {
      throw new GithubError("failed", `GitHub responded with ${response.status}`);
    }

    try {
      return toGithubUser((await response.json()) as GithubApiUser);
    } catch (error) {
      throw new GithubError("failed", "Invalid GitHub response", { cause: error });
    }
  }

  function readCache(key: string): GithubUser | undefined {
    const entry = cache.get(key);
    if (!entry) {
      return;
    }
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return;
    }
    return entry.user;
  }

  function writeCache(key: string, user: GithubUser) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const current = now();
      for (const [cachedKey, entry] of cache) {
        if (entry.expiresAt <= current) {
          cache.delete(cachedKey);
        }
      }
      // Still full: drop the oldest insertion.
      const oldest = cache.keys().next();
      if (cache.size >= MAX_CACHE_ENTRIES && !oldest.done) {
        cache.delete(oldest.value);
      }
    }
    cache.set(key, { user, expiresAt: now() + cacheTtlMs });
  }

  return {
    async getUserByLogin(login, lookupOptions) {
      const key = login.toLowerCase();
      const cached = lookupOptions?.fresh ? undefined : readCache(key);
      if (cached) {
        return cached;
      }
      const user = await request(`/users/${encodeURIComponent(login)}`);
      writeCache(key, user);
      return user;
    },
    getUserById(id) {
      return request(`/user/${id}`);
    },
  };
}
