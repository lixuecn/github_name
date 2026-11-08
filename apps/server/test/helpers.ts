import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Context } from "@my-better-t-app/api/context";
import { GithubError, type GithubClient, type GithubUser } from "@my-better-t-app/api/github-client";
import { createRateLimiter } from "@my-better-t-app/api/rate-limit";
import { appRouter } from "@my-better-t-app/api/routers/index";
import { createPrismaClient, type Database } from "@my-better-t-app/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../packages/db/prisma/migrations", import.meta.url));
const STATEMENT_SEPARATOR = /;\s*\n/;

/**
 * Creates (once) and resets a dedicated `<db>_github_test` database next to the
 * development database, then applies the Prisma migrations to it. Development
 * data is never touched.
 */
export async function createTestDatabase(): Promise<Database> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL is required to run server tests");
  }
  const url = new URL(baseUrl);
  const testName = `${url.pathname.slice(1) || "postgres"}_github_test`;

  const admin = createPrismaClient({ DATABASE_URL: url.toString() });
  const existing = await admin.$queryRawUnsafe<unknown[]>(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    testName
  );
  if (existing.length === 0) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${testName}"`);
  }
  await admin.$disconnect();

  url.pathname = `/${testName}`;
  const db = createPrismaClient({ DATABASE_URL: url.toString() });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");

  const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(`${MIGRATIONS_DIR}/${migration}/migration.sql`, "utf8");
    for (const statement of sql.split(STATEMENT_SEPARATOR)) {
      const withoutComments = statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (withoutComments) {
        await db.$executeRawUnsafe(withoutComments);
      }
    }
  }
  return db;
}

let nextGithubId = 1000;

export function makeGithubUser(overrides: Partial<GithubUser> = {}): GithubUser {
  nextGithubId += 1;
  const login = overrides.login ?? `user${nextGithubId}`;
  return {
    githubId: nextGithubId,
    login,
    name: `Name ${login}`,
    bio: "bio",
    company: "Acme",
    location: "Earth",
    blog: "https://example.com",
    twitterUsername: null,
    avatarUrl: `https://avatars.example.com/${login}`,
    htmlUrl: `https://github.com/${login}`,
    publicRepos: 1,
    followers: 1,
    following: 0,
    githubCreatedAt: new Date("2020-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** In-memory GitHub client; set `failWith` to make every call throw. */
export class FakeGithubClient implements GithubClient {
  readonly users = new Map<number, GithubUser>();
  failWith: GithubError | null = null;
  calls = 0;
  freshLookups = 0;

  add(user: GithubUser): GithubUser {
    this.users.set(user.githubId, user);
    return user;
  }

  getUserByLogin = (login: string, options?: { fresh?: boolean }): Promise<GithubUser> => {
    this.calls += 1;
    if (options?.fresh) {
      this.freshLookups += 1;
    }
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    for (const user of this.users.values()) {
      if (user.login.toLowerCase() === login.toLowerCase()) {
        return Promise.resolve(user);
      }
    }
    return Promise.reject(new GithubError("not_found", "not found"));
  };

  getUserById = (id: number): Promise<GithubUser> => {
    this.calls += 1;
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    const user = this.users.get(id);
    return user ? Promise.resolve(user) : Promise.reject(new GithubError("not_found", "not found"));
  };
}

export function makeContext(db: Database, github: GithubClient, clientIp = "203.0.113.1"): Context {
  return {
    db,
    github,
    rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    clientIp,
  };
}

export const createCaller = (context: Context) => appRouter.createCaller(context);
