import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";

import { getSessionCookie, request, signUp, startServer, stopServer, uniqueUsername } from "./helpers";

let server: ChildProcess;

before(async () => {
  server = await startServer();
});

after(async () => {
  await stopServer(server);
});

test("protected procedures reject anonymous calls with UNAUTHORIZED", async () => {
  const { response, json } = await request("/trpc/privateData");

  assert.equal(response.status, 401);
  assert.equal((json as { error: { data: { code: string } } }).error.data.code, "UNAUTHORIZED");
});

test("protected procedures return data for the signed-in user", async () => {
  const username = uniqueUsername();
  const { response: signUpResponse } = await signUp(username, "password123");

  const { response, json } = await request("/trpc/privateData", {
    cookie: getSessionCookie(signUpResponse),
  });

  assert.equal(response.status, 200);
  assert.equal(
    (json as { result: { data: { user: { name: string } } } }).result.data.user.name,
    username,
  );
});
