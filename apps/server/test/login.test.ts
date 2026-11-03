import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";

import {
  getDatabase,
  getSessionCookie,
  request,
  signUp,
  startServer,
  stopServer,
  uniqueUsername,
} from "./helpers";

const PASSWORD = "password123";

const db = getDatabase();
let server: ChildProcess;

before(async () => {
  server = await startServer();
});

after(async () => {
  await stopServer(server);
  await db.$disconnect();
});

function signIn(username: string, password: string) {
  return request("/api/auth/sign-in/username", { body: { username, password } });
}

test("signs in with a username regardless of case", async () => {
  const username = uniqueUsername();
  assert.equal((await signUp(username, PASSWORD)).response.status, 200);

  const { response, json } = await signIn(username.toUpperCase(), PASSWORD);

  assert.equal(response.status, 200);
  assert.ok(getSessionCookie(response).includes("session_token"));
  assert.equal((json as { user: { username: string } }).user.username, username);
});

test("returns the same error for a wrong password and an unknown user", async () => {
  const username = uniqueUsername();
  assert.equal((await signUp(username, PASSWORD)).response.status, 200);

  const wrongPassword = await signIn(username, "wrong-password");
  const unknownUser = await signIn(uniqueUsername(), PASSWORD);

  assert.equal(wrongPassword.response.status, 401);
  assert.equal(unknownUser.response.status, wrongPassword.response.status);
  assert.deepEqual(unknownUser.json, wrongPassword.json);
  assert.equal((wrongPassword.json as { code: string }).code, "INVALID_USERNAME_OR_PASSWORD");
});

test("disables email sign-in, even with the placeholder email", async () => {
  const username = uniqueUsername();
  assert.equal((await signUp(username, PASSWORD)).response.status, 200);
  const user = await db.user.findUnique({ where: { username } });

  const { response } = await request("/api/auth/sign-in/email", {
    body: { email: user?.email, password: PASSWORD },
  });

  assert.equal(response.status, 404);
  assert.equal(getSessionCookie(response).includes("session_token"), false);
});
