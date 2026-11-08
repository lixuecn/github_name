import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createRateLimiter } from "@my-better-t-app/api/rate-limit";
import type { Database } from "@my-better-t-app/db";

import { createApp } from "../src/app";
import { createTestDatabase, FakeGithubClient, makeGithubUser } from "./helpers";

const TEST_IP_HEADER = "x-test-client-ip";
const RATE_LIMIT = 30;

let db: Database;
let github: FakeGithubClient;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await createTestDatabase();
  github = new FakeGithubClient();
  app = createApp((context) => context.req.header(TEST_IP_HEADER), {
    db,
    github,
    rateLimiter: createRateLimiter({ limit: RATE_LIMIT, windowMs: 60_000 }),
  });
});

after(async () => {
  await db.$disconnect();
});

const query = (path: string, input: unknown, ip: string) =>
  app.request(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, {
    headers: { [TEST_IP_HEADER]: ip },
  });

const mutate = (path: string, input: unknown, ip: string) =>
  app.request(`/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", [TEST_IP_HEADER]: ip },
    body: JSON.stringify(input),
  });

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { message: string; data: { code: string } } };
  return { status: response.status, code: body.error.data.code, message: body.error.message };
}

test("healthCheck responds over HTTP", async () => {
  const response = await app.request("/trpc/healthCheck");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { data: "OK" } });
});

test("GitHub not-found and validation errors use HTTP status codes and Chinese messages", async () => {
  assert.deepEqual(await errorOf(await query("github.search", { username: "ghost" }, "198.51.100.1")), {
    status: 404,
    code: "NOT_FOUND",
    message: "未找到该 GitHub 用户",
  });
  const invalid = await errorOf(await query("github.search", { username: "-x" }, "198.51.100.1"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.code, "BAD_REQUEST");
});

test("rate limit: the 31st limited call from one IP gets 429, other IPs and list are unaffected", async () => {
  github.add(makeGithubUser({ login: "limited" }));
  const ip = "198.51.100.7";
  // Mix procedures: they share one budget per IP.
  for (let index = 0; index < RATE_LIMIT; index += 1) {
    const response =
      index % 2 === 0
        ? await query("github.search", { username: "limited" }, ip)
        : await mutate("github.delete", { id: "missing" }, ip);
    assert.notEqual(response.status, 429, `call ${index + 1}`);
  }
  assert.deepEqual(await errorOf(await query("github.search", { username: "limited" }, ip)), {
    status: 429,
    code: "TOO_MANY_REQUESTS",
    message: "请求过于频繁，请稍后再试",
  });

  const otherIp = await query("github.search", { username: "limited" }, "198.51.100.8");
  assert.equal(otherIp.status, 200);

  const list = await query("github.list", {}, ip);
  assert.equal(list.status, 200);
});
