import assert from "node:assert/strict";
import { test } from "node:test";

import { createGoApiProfileReader, GoApiError } from "@my-better-t-app/api/profile-reader";

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

function fakeFetch(respond: (url: URL) => Response) {
  const urls: URL[] = [];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    urls.push(url);
    return Promise.resolve(respond(url));
  };
  return { fetch: fetchImpl as typeof fetch, urls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const baseInput = { keyword: "", sort: "createdAt", cursor: null, limit: 20 } as const;

test("builds the query string and drops empty keyword/cursor", async () => {
  const { fetch, urls } = fakeFetch(() => json({ items: [], total: 0, nextCursor: null }));
  const reader = createGoApiProfileReader({ baseUrl: "http://go-api.internal:8080//", fetch });

  await reader.list(baseInput);
  await reader.list({ keyword: "50% off", sort: "followers", cursor: "cabc", limit: 5 });

  assert.equal(urls[0]?.origin + (urls[0]?.pathname ?? ""), "http://go-api.internal:8080/profiles");
  assert.deepEqual(Object.fromEntries(urls[0]?.searchParams ?? []), { sort: "createdAt", limit: "20" });
  assert.deepEqual(Object.fromEntries(urls[1]?.searchParams ?? []), {
    sort: "followers",
    limit: "5",
    keyword: "50% off",
    cursor: "cabc",
  });
});

test("parses timestamps into Date objects", async () => {
  const { fetch } = fakeFetch(() => json({ items: [PROFILE], total: 1, nextCursor: "c1" }));
  const page = await createGoApiProfileReader({ baseUrl: "http://x", fetch }).list(baseInput);

  assert.equal(page.total, 1);
  assert.equal(page.nextCursor, "c1");
  const [item] = page.items;
  assert.ok(item?.createdAt instanceof Date);
  assert.equal(item?.createdAt.toISOString(), "2026-11-10T01:02:03.456Z");
  assert.equal(item?.githubCreatedAt.toISOString(), "2020-01-01T00:00:00.000Z");
});

test("non-2xx responses, bad payloads and network failures become GoApiError", async () => {
  const failing = [
    () => json({ error: { code: "INTERNAL_SERVER_ERROR", message: "x" } }, 500),
    () => json({ items: [{ ...PROFILE, createdAt: "not a date" }], total: 1, nextCursor: null }),
    () => json({ items: "nope" }),
  ];
  for (const respond of failing) {
    const { fetch } = fakeFetch(respond);
    await assert.rejects(createGoApiProfileReader({ baseUrl: "http://x", fetch }).list(baseInput), GoApiError);
  }

  const offline = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
  await assert.rejects(
    createGoApiProfileReader({ baseUrl: "http://x", fetch: offline }).list(baseInput),
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
      createGoApiProfileReader({ baseUrl: "http://x", fetch: hung, timeoutMs: 50 }).list(baseInput),
      GoApiError
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
