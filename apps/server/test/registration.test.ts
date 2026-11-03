import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";

import { toPlaceholderEmail } from "@my-better-t-app/auth/username";

import {
  getDatabase,
  getSessionCookie,
  randomClientIp,
  request,
  signUp,
  startServer,
  stopServer,
  uniqueUsername,
} from "./helpers";

const PASSWORD = "password123";
const SIGN_UP_RATE_LIMIT = 5;

const db = getDatabase();
let server: ChildProcess;

before(async () => {
  server = await startServer();
});

after(async () => {
  await stopServer(server);
  await db.$disconnect();
});

test("registers a user, normalizes the username and signs them in", async () => {
  const username = `Mixed_${uniqueUsername()}`;
  const { response, json } = await signUp(username, PASSWORD);

  assert.equal(response.status, 200);
  assert.ok(getSessionCookie(response).includes("session_token"));
  assert.equal((json as { user: { name: string } }).user.name, username);

  const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });
  assert.ok(user, "user row should exist");
  assert.equal(user.displayUsername, username);
});

test("ignores the client email and stores a placeholder derived from the username", async () => {
  const username = uniqueUsername();
  const { response } = await request("/api/auth/sign-up/email", {
    body: { email: "attacker@example.com", name: username, username, password: PASSWORD },
  });

  assert.equal(response.status, 200);
  const user = await db.user.findUnique({ where: { username } });
  assert.equal(user?.email, `${username}@users.invalid`);
});

test("rejects sign-up without a username", async () => {
  const email = `${uniqueUsername()}@example.com`;
  const { response } = await request("/api/auth/sign-up/email", {
    body: { email, name: "No Username", password: PASSWORD },
  });

  assert.equal(response.status, 400);
  assert.equal(await db.user.count({ where: { email } }), 0);
});

test("rejects usernames that break the format rules", async () => {
  for (const username of ["ab", "a-b-c", "a".repeat(21), "dot.name"]) {
    const { response } = await signUp(username, PASSWORD);
    assert.equal(response.status, 400, `expected 400 for ${username}`);
  }
});

test("rejects a username that is already taken, ignoring case", async () => {
  const username = uniqueUsername();
  assert.equal((await signUp(username, PASSWORD)).response.status, 200);

  const { response, json } = await signUp(username.toUpperCase(), PASSWORD);

  assert.equal(response.status, 400);
  assert.equal((json as { code: string }).code, "USERNAME_IS_ALREADY_TAKEN");
});

test("does not allow changing the username after sign-up", async () => {
  const username = uniqueUsername();
  const signUpResult = await signUp(username, PASSWORD);
  const cookie = getSessionCookie(signUpResult.response);

  const { response } = await request("/api/auth/update-user", {
    body: { username: uniqueUsername() },
    cookie,
  });

  assert.equal(response.status, 400);
  const user = await db.user.findUnique({ where: { email: toPlaceholderEmail(username) } });
  assert.equal(user?.username, username);
});

test("rate limits repeated sign-up attempts from one client", async () => {
  const ip = randomClientIp();
  const statuses: number[] = [];
  for (let attempt = 0; attempt <= SIGN_UP_RATE_LIMIT; attempt += 1) {
    statuses.push((await signUp("ab", PASSWORD, ip)).response.status);
  }

  assert.deepEqual(statuses.slice(0, SIGN_UP_RATE_LIMIT), Array.from({ length: SIGN_UP_RATE_LIMIT }, () => 400));
  assert.equal(statuses.at(-1), 429);

  const otherClient = await signUp("ab", PASSWORD, randomClientIp());
  assert.equal(otherClient.response.status, 400, "other clients keep their own bucket");
});
