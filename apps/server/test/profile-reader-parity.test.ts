import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createGoApiProfileReader, type ProfileListInput } from "@my-better-t-app/api/profile-reader";
import type { Database } from "@my-better-t-app/db";

import {
  createCaller,
  createTestDatabase,
  FakeGithubClient,
  makeContext,
  makeGithubUser,
  testDatabaseUrl,
} from "./helpers";

// Runs github.list through Prisma and through the real Go service against the
// same test database, and requires identical results. The Go service lives in
// its own repository: point GO_API_DIR at a checkout (default: a `go-api`
// directory next to this repository). Skipped when the checkout or the Go
// toolchain is missing.

const GO_API_DIR =
  process.env.GO_API_DIR ?? fileURLToPath(new URL("../../../../go-api", import.meta.url));
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 100;

function goAvailable(): boolean {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))
      );
    });
  });
}

async function waitForReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/ready`)).ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`go-api did not become ready at ${baseUrl}`);
}

function skipReason(): string | false {
  if (!existsSync(join(GO_API_DIR, "go.mod"))) {
    return `go-api checkout not found at ${GO_API_DIR} (set GO_API_DIR)`;
  }
  return goAvailable() ? false : "Go toolchain not installed";
}

const skip = skipReason();

let db: Database;
let goApi: ChildProcess | undefined;
let buildDir: string | undefined;
let prismaCaller: ReturnType<typeof createCaller>;
let goCaller: ReturnType<typeof createCaller>;

before(async () => {
  if (skip) {
    return;
  }
  db = await createTestDatabase();
  await db.githubProfile.deleteMany();

  buildDir = mkdtempSync(join(tmpdir(), "go-api-parity-"));
  const binary = join(buildDir, "go-api");
  execFileSync("go", ["build", "-o", binary, "./cmd/server"], {
    cwd: GO_API_DIR,
    env: { ...process.env, CGO_ENABLED: "0" },
    stdio: "inherit",
  });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  goApi = spawn(binary, [], {
    env: { PATH: process.env.PATH, PORT: String(port), DATABASE_URL: testDatabaseUrl() },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForReady(baseUrl);

  const github = new FakeGithubClient();
  prismaCaller = createCaller(makeContext(db, github));
  goCaller = createCaller(
    makeContext(db, github, "203.0.113.1", createGoApiProfileReader({ baseUrl }))
  );

  // Ties in followers / repos exercise the id tiebreaker; notes contain LIKE
  // wildcards that must match literally.
  const seeds = [
    { login: "alice", name: "Alice Zhang", followers: 50, publicRepos: 3, note: "50%_off 客户" },
    { login: "bob", name: null, followers: 20, publicRepos: 9, note: null },
    { login: "carol", name: "Carol", followers: 20, publicRepos: 3, note: "rustacean" },
    { login: "dave", name: "ALICE fan", followers: 7, publicRepos: 9, note: null },
    { login: "erin", name: "Erin", followers: 20, publicRepos: 0, note: "前端" },
    { login: "frank", name: "Frank", followers: 0, publicRepos: 1, note: "back\\slash" },
  ];
  for (const seed of seeds) {
    github.add(makeGithubUser(seed));
    await prismaCaller.github.create({ username: seed.login, note: seed.note ?? undefined });
  }
  const [first] = (await prismaCaller.github.list({})).items;
  if (first) {
    await prismaCaller.github.update({ id: first.id, tags: ["后端", "Go"] });
  }
});

after(async () => {
  goApi?.kill("SIGTERM");
  if (buildDir) {
    rmSync(buildDir, { recursive: true, force: true });
  }
  await db?.$disconnect();
});

type ListArgs = Parameters<ReturnType<typeof createCaller>["github"]["list"]>[0];

const cases: ListArgs[] = [
  {},
  { sort: "followers" },
  { sort: "publicRepos" },
  { keyword: "alice" },
  { keyword: "  ALICE  " },
  { keyword: "%_" },
  { keyword: "客户" },
  { keyword: "\\" },
  { keyword: "nobody" },
  { limit: 50 },
  { cursor: "deleted-row-id" },
];

test("list returns identical pages through Prisma and the Go service", { skip }, async () => {
  for (const args of cases) {
    const viaPrisma = await prismaCaller.github.list(args);
    const viaGo = await goCaller.github.list(args);
    assert.deepStrictEqual(viaGo, viaPrisma, `mismatch for ${JSON.stringify(args)}`);
  }
});

test("cursor pagination walks the same rows in the same order", { skip }, async () => {
  const sorts: ProfileListInput["sort"][] = ["createdAt", "followers", "publicRepos"];
  for (const sort of sorts) {
    const walk = async (caller: ReturnType<typeof createCaller>) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result = await caller.github.list({ sort, limit: 2, cursor });
        ids.push(...result.items.map((item) => item.id));
        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }
      return ids;
    };
    const viaPrisma = await walk(prismaCaller);
    assert.equal(viaPrisma.length, 6, `prisma walked ${viaPrisma.length} rows for ${sort}`);
    assert.deepEqual(await walk(goCaller), viaPrisma, `pagination mismatch for sort=${sort}`);
  }
});
