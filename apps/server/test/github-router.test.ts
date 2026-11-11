import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { GithubError } from "@my-better-t-app/api/github-client";
import type { Database } from "@my-better-t-app/db";
import { TRPCError } from "@trpc/server";

import { createCaller, createTestDatabase, FakeGithubClient, makeContext, makeGithubUser } from "./helpers";

let db: Database;
let github: FakeGithubClient;
let caller: ReturnType<typeof createCaller>;

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.githubProfile.deleteMany();
  github = new FakeGithubClient();
  caller = createCaller(makeContext(db, github));
});

async function expectTrpc(promise: Promise<unknown>, code: TRPCError["code"], message?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TRPCError, String(error));
    assert.equal(error.code, code);
    if (message) {
      assert.equal(error.message, message);
    }
    return true;
  });
}

test("search returns the profile and whether it is already in the system", async () => {
  const user = github.add(makeGithubUser({ login: "Octo" }));
  const first = await caller.github.search({ username: " octo " });
  assert.equal(first.githubId, user.githubId);
  assert.equal(first.existsInSystem, false);

  await caller.github.create({ username: "octo" });
  const second = await caller.github.search({ username: "octo" });
  assert.equal(second.existsInSystem, true);
});

test("search validates the username before calling GitHub", async () => {
  await expectTrpc(caller.github.search({ username: "-bad" }), "BAD_REQUEST");
  assert.equal(github.calls, 0);
});

test("search maps GitHub errors to user-facing tRPC errors", async () => {
  await expectTrpc(caller.github.search({ username: "ghost" }), "NOT_FOUND", "未找到该 GitHub 用户");
  github.failWith = new GithubError("rate_limited", "x");
  await expectTrpc(
    caller.github.search({ username: "ghost" }),
    "TOO_MANY_REQUESTS",
    "GitHub 请求过于频繁，请稍后再试"
  );
  github.failWith = new GithubError("failed", "x");
  await expectTrpc(caller.github.search({ username: "ghost" }), "BAD_GATEWAY", "查询失败，请稍后重试");
});

test("create stores GitHub data with a trimmed note and rejects duplicates", async () => {
  const user = github.add(makeGithubUser({ login: "alice" }));
  const created = await caller.github.create({ username: "alice", note: "  核心成员 " });
  assert.equal(created.githubId, user.githubId);
  assert.equal(created.login, "alice");
  assert.equal(created.followers, user.followers);
  assert.equal(created.note, "核心成员");
  assert.deepEqual(created.tags, []);
  assert.ok(created.syncedAt instanceof Date);

  await expectTrpc(caller.github.create({ username: "ALICE" }), "CONFLICT", "该用户已在系统中");
  assert.equal(await db.githubProfile.count(), 1);
  // Every create bypasses the search cache.
  assert.equal(github.freshLookups, 2);
});

test("create treats a blank note as no note and rejects notes over 200 chars", async () => {
  github.add(makeGithubUser({ login: "bob" }));
  const created = await caller.github.create({ username: "bob", note: "   " });
  assert.equal(created.note, null);
  github.add(makeGithubUser({ login: "carol" }));
  await expectTrpc(caller.github.create({ username: "carol", note: "x".repeat(201) }), "BAD_REQUEST");
});

test("create maps a concurrent unique violation to CONFLICT", async () => {
  github.add(makeGithubUser({ login: "dave" }));
  const results = await Promise.allSettled([
    caller.github.create({ username: "dave" }),
    caller.github.create({ username: "dave" }),
  ]);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(reason instanceof TRPCError);
  assert.equal(reason.code, "CONFLICT");
  assert.equal(await db.githubProfile.count(), 1);
});

async function seed(count: number) {
  for (let index = 0; index < count; index += 1) {
    github.add(
      makeGithubUser({
        login: `member${String(index).padStart(2, "0")}`,
        followers: index % 5,
        publicRepos: count - index,
      })
    );
    await caller.github.create({ username: `member${String(index).padStart(2, "0")}` });
  }
}

test("list paginates with a stable cursor and reports the total", async () => {
  await seed(25);
  const first = await caller.github.list({});
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 25);
  assert.ok(first.nextCursor);

  const second = await caller.github.list({ cursor: first.nextCursor });
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);

  const ids = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(new Set(ids).size, 25);
  // Default order: newest first.
  assert.equal(first.items[0]?.login, "member24");
});

test("list sorts by followers and repos with id as a tiebreaker", async () => {
  await seed(12);
  const byFollowers = await caller.github.list({ sort: "followers", limit: 50 });
  const followers = byFollowers.items.map((item) => item.followers);
  assert.deepEqual(followers, [...followers].sort((a, b) => b - a));

  // Paging through ties must not skip or repeat rows.
  const pageA = await caller.github.list({ sort: "followers", limit: 5 });
  const pageB = await caller.github.list({ sort: "followers", limit: 5, cursor: pageA.nextCursor });
  const pageC = await caller.github.list({ sort: "followers", limit: 5, cursor: pageB.nextCursor });
  const paged = [...pageA.items, ...pageB.items, ...pageC.items].map((item) => item.id);
  assert.deepEqual(paged, byFollowers.items.map((item) => item.id));

  const byRepos = await caller.github.list({ sort: "publicRepos", limit: 50 });
  const repos = byRepos.items.map((item) => item.publicRepos);
  assert.deepEqual(repos, [...repos].sort((a, b) => b - a));
});

test("list filters by login, name and note, case-insensitively", async () => {
  github.add(makeGithubUser({ login: "zed", name: "Zed Shaw" }));
  github.add(makeGithubUser({ login: "amy", name: null }));
  github.add(makeGithubUser({ login: "kim", name: "Kim" }));
  await caller.github.create({ username: "zed" });
  await caller.github.create({ username: "amy", note: "Rust 专家" });
  await caller.github.create({ username: "kim" });

  assert.deepEqual((await caller.github.list({ keyword: "ZED" })).items.map((i) => i.login), ["zed"]);
  assert.deepEqual((await caller.github.list({ keyword: "shaw" })).items.map((i) => i.login), ["zed"]);
  assert.deepEqual((await caller.github.list({ keyword: "rust" })).items.map((i) => i.login), ["amy"]);
  const all = await caller.github.list({ keyword: "  " });
  assert.equal(all.total, 3);
  const none = await caller.github.list({ keyword: "nobody" });
  assert.equal(none.total, 0);
  assert.deepEqual(none.items, []);
});

test("list matches LIKE wildcards and backslashes in the keyword literally", async () => {
  github.add(makeGithubUser({ login: "pct", name: null }));
  github.add(makeGithubUser({ login: "slash", name: null }));
  github.add(makeGithubUser({ login: "plain", name: null }));
  await caller.github.create({ username: "pct", note: "50%_off" });
  await caller.github.create({ username: "slash", note: "back\\slash" });
  await caller.github.create({ username: "plain" });

  const logins = async (keyword: string) =>
    (await caller.github.list({ keyword })).items.map((i) => i.login).sort();
  assert.deepEqual(await logins("%"), ["pct"]);
  assert.deepEqual(await logins("_"), ["pct"]);
  assert.deepEqual(await logins("%_"), ["pct"]);
  assert.deepEqual(await logins("\\"), ["slash"]);
});

test("list falls back to the first page when the cursor row was deleted", async () => {
  await seed(3);
  const first = await caller.github.list({ limit: 1 });
  const cursor = first.nextCursor as string;
  await caller.github.delete({ id: cursor });
  const page = await caller.github.list({ limit: 1, cursor });
  const freshFirst = await caller.github.list({ limit: 1 });
  assert.equal(page.items[0]?.id, freshFirst.items[0]?.id);
  assert.equal(page.total, 2);
});

test("update changes only the provided fields and normalises tags", async () => {
  const user = github.add(makeGithubUser({ login: "erin" }));
  const created = await caller.github.create({ username: "erin", note: "old" });

  const tagged = await caller.github.update({ id: created.id, tags: [" 前端 ", "前端", "后端", ""] });
  assert.deepEqual(tagged.tags, ["前端", "后端"]);
  assert.equal(tagged.note, "old");

  const cleared = await caller.github.update({ id: created.id, note: null });
  assert.equal(cleared.note, null);
  assert.deepEqual(cleared.tags, ["前端", "后端"]);
  assert.equal(cleared.followers, user.followers);
  assert.equal(cleared.syncedAt.getTime(), created.syncedAt.getTime());

  await expectTrpc(caller.github.update({ id: created.id, tags: ["1", "2", "3", "4", "5", "6"] }), "BAD_REQUEST");
  await expectTrpc(caller.github.update({ id: "missing", note: "x" }), "NOT_FOUND", "该人员不存在");
});

test("sync refreshes GitHub fields, keeps note and tags, and handles deleted accounts", async () => {
  const user = github.add(makeGithubUser({ login: "frank", followers: 1 }));
  const created = await caller.github.create({ username: "frank", note: "keep" });
  await caller.github.update({ id: created.id, tags: ["t"] });

  github.add({ ...user, login: "frank-renamed", followers: 99 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const synced = await caller.github.sync({ id: created.id });
  assert.equal(synced.login, "frank-renamed");
  assert.equal(synced.followers, 99);
  assert.equal(synced.note, "keep");
  assert.deepEqual(synced.tags, ["t"]);
  assert.ok(synced.syncedAt > created.syncedAt);

  github.users.delete(user.githubId);
  await expectTrpc(caller.github.sync({ id: created.id }), "NOT_FOUND", "该 GitHub 用户已不存在");
  assert.equal(await db.githubProfile.count(), 1);

  await expectTrpc(caller.github.sync({ id: "missing" }), "NOT_FOUND", "该人员不存在");
});

test("delete removes the record and reports missing ones", async () => {
  github.add(makeGithubUser({ login: "gina" }));
  const created = await caller.github.create({ username: "gina" });
  assert.deepEqual(await caller.github.delete({ id: created.id }), { id: created.id });
  assert.equal((await caller.github.list({})).total, 0);
  await expectTrpc(caller.github.delete({ id: created.id }), "NOT_FOUND", "该人员不存在");
});
