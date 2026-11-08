import assert from "node:assert/strict";
import { test } from "node:test";

import { createGithubClient, GithubError } from "@my-better-t-app/api/github-client";

const apiUser = {
  id: 1024025,
  login: "torvalds",
  name: "Linus Torvalds",
  bio: "",
  company: "Linux Foundation",
  location: "Portland, OR",
  blog: "",
  twitter_username: null,
  avatar_url: "https://avatars.githubusercontent.com/u/1024025?v=4",
  html_url: "https://github.com/torvalds",
  public_repos: 8,
  followers: 230_000,
  following: 0,
  created_at: "2011-09-03T15:26:22Z",
};

type Call = { url: string; headers: Record<string, string> };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

async function expectKind(promise: Promise<unknown>, kind: GithubError["kind"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof GithubError);
    assert.equal(error.kind, kind);
    return true;
  });
}

test("maps the GitHub user and sends the expected headers without a token", async () => {
  const { calls, impl } = fakeFetch(() => json(apiUser));
  const client = createGithubClient({ fetch: impl });
  const user = await client.getUserByLogin("torvalds");

  assert.equal(calls[0]?.url, "https://api.github.com/users/torvalds");
  assert.equal(calls[0]?.headers.Authorization, undefined);
  assert.equal(calls[0]?.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.deepEqual(user, {
    githubId: 1024025,
    login: "torvalds",
    name: "Linus Torvalds",
    bio: null,
    company: "Linux Foundation",
    location: "Portland, OR",
    blog: null,
    twitterUsername: null,
    avatarUrl: apiUser.avatar_url,
    htmlUrl: apiUser.html_url,
    publicRepos: 8,
    followers: 230_000,
    following: 0,
    githubCreatedAt: new Date("2011-09-03T15:26:22Z"),
  });
});

test("sends a bearer token when configured", async () => {
  const { calls, impl } = fakeFetch(() => json(apiUser));
  await createGithubClient({ fetch: impl, token: "secret" }).getUserById(1024025);
  assert.equal(calls[0]?.url, "https://api.github.com/user/1024025");
  assert.equal(calls[0]?.headers.Authorization, "Bearer secret");
});

test("classifies GitHub failures", async () => {
  const cases: [() => Response, GithubError["kind"]][] = [
    [() => new Response("", { status: 404 }), "not_found"],
    [() => new Response("", { status: 429 }), "rate_limited"],
    [() => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }), "rate_limited"],
    [() => new Response("", { status: 403, headers: { "retry-after": "60" } }), "rate_limited"],
    [() => new Response("", { status: 403 }), "failed"],
    [() => new Response("", { status: 500 }), "failed"],
    [() => new Response("not json", { status: 200 }), "failed"],
  ];
  for (const [respond, kind] of cases) {
    const { impl } = fakeFetch(respond);
    await expectKind(createGithubClient({ fetch: impl }).getUserByLogin("x"), kind);
  }
});

test("treats network errors and timeouts as failed", async () => {
  const networkError = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
  await expectKind(createGithubClient({ fetch: networkError }).getUserByLogin("x"), "failed");

  // AbortSignal.timeout uses an unref'd timer; keep the loop alive like a real server would.
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const keepAlive = setTimeout(() => undefined, 5000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(init.signal?.reason);
      });
    })) as typeof fetch;
  const started = Date.now();
  await expectKind(createGithubClient({ fetch: hanging, timeoutMs: 50 }).getUserByLogin("x"), "failed");
  assert.ok(Date.now() - started < 2000);
});

test("caches login lookups case-insensitively until the TTL expires", async () => {
  let current = 0;
  const { calls, impl } = fakeFetch(() => json(apiUser));
  const client = createGithubClient({ fetch: impl, now: () => current, cacheTtlMs: 60_000 });

  await client.getUserByLogin("torvalds");
  current = 59_999;
  await client.getUserByLogin("TORVALDS");
  assert.equal(calls.length, 1);

  current = 60_000;
  await client.getUserByLogin("torvalds");
  assert.equal(calls.length, 2);
});

test("fresh lookups bypass the cache and refresh it", async () => {
  let followers = 1;
  const { calls, impl } = fakeFetch(() => json({ ...apiUser, followers }));
  const client = createGithubClient({ fetch: impl });

  await client.getUserByLogin("torvalds");
  followers = 2;
  const fresh = await client.getUserByLogin("torvalds", { fresh: true });
  assert.equal(fresh.followers, 2);
  assert.equal(calls.length, 2);

  const cached = await client.getUserByLogin("torvalds");
  assert.equal(cached.followers, 2);
  assert.equal(calls.length, 2);
});

test("does not cache failures or id lookups", async () => {
  let status = 404;
  const { calls, impl } = fakeFetch(() => (status === 200 ? json(apiUser) : new Response("", { status })));
  const client = createGithubClient({ fetch: impl });
  await expectKind(client.getUserByLogin("torvalds"), "not_found");
  status = 200;
  await client.getUserByLogin("torvalds");
  await client.getUserById(1);
  await client.getUserById(1);
  assert.equal(calls.length, 4);
});
