import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createGoApiProfileStore, type ProfileListInput } from "@my-better-t-app/api/profile-store";
import type { Database } from "@my-better-t-app/db";

import { goApiSkipReason, type RunningGoApi, startGoApi } from "./go-api-server";
import {
  createCaller,
  createTestDatabase,
  FakeGithubClient,
  makeContext,
  makeGithubUser,
  testDatabaseUrl,
} from "./helpers";

// Runs github.list through Prisma and through the real Go service against the
// same test database, and requires identical results (exact values, including
// timestamps, so it compares stored data rather than just shapes). Skipped
// when no go-api checkout or Go toolchain is available.

const skip = goApiSkipReason();

let db: Database;
let goApi: RunningGoApi | undefined;
let prismaCaller: ReturnType<typeof createCaller>;
let goCaller: ReturnType<typeof createCaller>;

before(async () => {
  if (skip) {
    return;
  }
  db = await createTestDatabase();
  await db.githubProfile.deleteMany();
  goApi = await startGoApi(testDatabaseUrl());

  const github = new FakeGithubClient();
  prismaCaller = createCaller(makeContext(db, github));
  goCaller = createCaller(
    makeContext(db, github, "203.0.113.1", createGoApiProfileStore({ baseUrl: goApi.baseUrl }))
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
  goApi?.stop();
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
