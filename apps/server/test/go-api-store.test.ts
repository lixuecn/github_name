import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGoApiProfileStore,
  GoApiError,
  ProfileConflictError,
  ProfileNotFoundError,
} from "@my-better-t-app/api/profile-store";

import { makeGithubUser } from "./helpers";

const PROFILE = {
  id: "c1",
  githubId: 1,
  login: "octo",
  name: null,
  bio: "bio",
  company: null,
  location: null,
  blog: null,
  twitterUsername: null,
  avatarUrl: "https://avatars.example.com/octo",
  htmlUrl: "https://github.com/octo",
  publicRepos: 2,
  followers: 3,
  following: 0,
  githubCreatedAt: "2020-01-01T00:00:00Z",
  note: null,
  tags: ["a"],
  syncedAt: "2026-11-10T01:02:03.456Z",
  createdAt: "2026-11-10T01:02:03.456Z",
  updatedAt: "2026-11-10T01:02:03.456Z",
};

type Recorded = { method: string; url: URL; body: unknown };

function fakeFetch(respond: (request: Recorded) => Response) {
  const requests: Recorded[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: Recorded = {
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return Promise.resolve(respond(request));
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const notFound = () => json({ error: { code: "NOT_FOUND", message: "该人员不存在" } }, 404);

const baseInput = { keyword: "", sort: "createdAt", cursor: null, limit: 20 } as const;

test("list builds the query string and drops empty keyword/cursor", async () => {
  const { fetch, requests } = fakeFetch(() => json({ items: [], total: 0, nextCursor: null }));
  const store = createGoApiProfileStore({ baseUrl: "http://go-api.internal:8080//", fetch });

  await store.list(baseInput);
  await store.list({ keyword: "50% off", sort: "followers", cursor: "cabc", limit: 5 });

  assert.equal(requests[0]?.url.origin + (requests[0]?.url.pathname ?? ""), "http://go-api.internal:8080/profiles");
  assert.deepEqual(Object.fromEntries(requests[0]?.url.searchParams ?? []), { sort: "createdAt", limit: "20" });
  assert.deepEqual(Object.fromEntries(requests[1]?.url.searchParams ?? []), {
    sort: "followers",
    limit: "5",
    keyword: "50% off",
    cursor: "cabc",
  });
});

test("parses timestamps into Date objects", async () => {
  const { fetch } = fakeFetch(() => json({ items: [PROFILE], total: 1, nextCursor: "c1" }));
  const page = await createGoApiProfileStore({ baseUrl: "http://x", fetch }).list(baseInput);

  assert.equal(page.total, 1);
  assert.equal(page.nextCursor, "c1");
  const [item] = page.items;
  assert.ok(item?.createdAt instanceof Date);
  assert.equal(item?.createdAt.toISOString(), "2026-11-10T01:02:03.456Z");
  assert.equal(item?.githubCreatedAt.toISOString(), "2020-01-01T00:00:00.000Z");
});

test("get and findByGithubId return null on 404", async () => {
  const { fetch, requests } = fakeFetch((r) => (r.url.pathname.endsWith("/c1") ? json(PROFILE) : notFound()));
  const store = createGoApiProfileStore({ baseUrl: "http://x", fetch });

  assert.equal((await store.get("c1"))?.id, "c1");
  assert.equal(await store.get("a/b?c"), null);
  assert.equal(await store.findByGithubId(42), null);
  assert.equal(requests[1]?.url.pathname, "/profiles/a%2Fb%3Fc");
  assert.equal(requests[2]?.url.pathname, "/profiles/by-github-id/42");
});

test("create sends the GitHub data with empty tags and maps 409 to ProfileConflictError", async () => {
  const user = makeGithubUser({ login: "octo" });
  const { fetch, requests } = fakeFetch(() => json(PROFILE, 201));
  const store = createGoApiProfileStore({ baseUrl: "http://x", fetch });

  await store.create({ ...user, note: "hi" });
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(requests[0]?.body, {
    ...user,
    githubCreatedAt: user.githubCreatedAt.toISOString(),
    note: "hi",
    tags: [],
  });

  const conflicting = createGoApiProfileStore({
    baseUrl: "http://x",
    fetch: fakeFetch(() => json({ error: { code: "CONFLICT", message: "x" } }, 409)).fetch,
  });
  await assert.rejects(conflicting.create({ ...user, note: null }), ProfileConflictError);
});

test("update sends only the given fields and maps 404 to ProfileNotFoundError", async () => {
  const { fetch, requests } = fakeFetch((r) => (r.url.pathname === "/profiles/c1" ? json(PROFILE) : notFound()));
  const store = createGoApiProfileStore({ baseUrl: "http://x", fetch });

  await store.update("c1", { note: null });
  await store.update("c1", { tags: ["x"] });
  assert.deepEqual(
    requests.map((r) => [r.method, r.body]),
    [
      ["PATCH", { note: null }],
      ["PATCH", { tags: ["x"] }],
    ]
  );
  await assert.rejects(store.update("missing", { note: "x" }), ProfileNotFoundError);
});

test("syncGithub sends GitHub columns only (no githubId/note/tags)", async () => {
  const user = makeGithubUser({ login: "octo" });
  const { fetch, requests } = fakeFetch((r) => (r.url.pathname === "/profiles/c1/github" ? json(PROFILE) : notFound()));
  const store = createGoApiProfileStore({ baseUrl: "http://x", fetch });

  await store.syncGithub("c1", user);
  assert.equal(requests[0]?.method, "PUT");
  const { githubId: _githubId, ...expected } = user;
  assert.deepEqual(requests[0]?.body, { ...expected, githubCreatedAt: user.githubCreatedAt.toISOString() });
  await assert.rejects(store.syncGithub("missing", user), ProfileNotFoundError);
});

test("delete expects 204 and maps 404 to ProfileNotFoundError", async () => {
  const { fetch } = fakeFetch((r) => (r.url.pathname === "/profiles/c1" ? new Response(null, { status: 204 }) : notFound()));
  const store = createGoApiProfileStore({ baseUrl: "http://x", fetch });
  await store.delete("c1");
  await assert.rejects(store.delete("missing"), ProfileNotFoundError);
});

test("server errors, bad payloads and network failures become GoApiError", async () => {
  const failing = [
    () => json({ error: { code: "INTERNAL_SERVER_ERROR", message: "x" } }, 500),
    () => json({ items: [{ ...PROFILE, createdAt: "not a date" }], total: 1, nextCursor: null }),
    () => json({ items: "nope" }),
  ];
  for (const respond of failing) {
    const { fetch } = fakeFetch(respond);
    await assert.rejects(createGoApiProfileStore({ baseUrl: "http://x", fetch }).list(baseInput), GoApiError);
  }
  const serverError = createGoApiProfileStore({ baseUrl: "http://x", fetch: fakeFetch(() => json({}, 500)).fetch });
  await assert.rejects(serverError.update("c1", { note: "x" }), GoApiError);
  await assert.rejects(serverError.delete("c1"), GoApiError);

  const offline = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
  await assert.rejects(
    createGoApiProfileStore({ baseUrl: "http://x", fetch: offline }).get("c1"),
    (error: unknown) => error instanceof GoApiError && error.status === null
  );
});

test("times out a hung request", async () => {
  const hung = ((_input: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  // AbortSignal.timeout's timer is unref'd; keep the loop alive until it fires
  // (a real server always has live handles, so this only matters in a test).
  const keepAlive = setTimeout(() => undefined, 5000);
  try {
    await assert.rejects(
      createGoApiProfileStore({ baseUrl: "http://x", fetch: hung, timeoutMs: 50 }).list(baseInput),
      GoApiError
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
