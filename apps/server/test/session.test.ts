import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";

import { getSessionCookie, request, signUp, startServer, stopServer, uniqueUsername } from "./helpers";

const PASSWORD = "password123";

let server: ChildProcess;

before(async () => {
  server = await startServer();
});

after(async () => {
  await stopServer(server);
});

async function signedInCookie(username: string): Promise<string> {
  const { response } = await signUp(username, PASSWORD);
  assert.equal(response.status, 200);
  return getSessionCookie(response);
}

test("a session cookie keeps resolving to the user on later requests", async () => {
  const username = uniqueUsername();
  const cookie = await signedInCookie(username);

  for (const _ of [1, 2]) {
    const { json } = await request("/api/auth/get-session", { cookie });
    assert.equal((json as { user: { name: string } }).user.name, username);
  }
});

test("private data greets the signed-in user in Chinese", async () => {
  const username = uniqueUsername();
  const cookie = await signedInCookie(username);

  const { response, json } = await request("/trpc/privateData", { cookie });

  assert.equal(response.status, 200);
  const data = (json as { result: { data: { message: string; user: { name: string } } } }).result
    .data;
  assert.equal(data.message, "这是受保护的数据");
  assert.equal(data.user.name, username);
});

test("signing out invalidates the session", async () => {
  const cookie = await signedInCookie(uniqueUsername());

  const signOut = await request("/api/auth/sign-out", { body: {}, cookie });
  assert.equal(signOut.response.status, 200);

  const { json } = await request("/api/auth/get-session", { cookie });
  assert.equal(json, null);
});
