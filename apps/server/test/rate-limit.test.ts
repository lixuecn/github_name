import assert from "node:assert/strict";
import { test } from "node:test";

import { createRateLimiter } from "@my-better-t-app/api/rate-limit";

test("allows `limit` hits per window, then blocks until the window resets", () => {
  let current = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => current });
  assert.deepEqual(
    [1, 2, 3, 4].map(() => limiter.consume("a")),
    [true, true, true, false]
  );
  current = 999;
  assert.equal(limiter.consume("a"), false);
  current = 1000;
  assert.equal(limiter.consume("a"), true);
});

test("counts keys independently", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
  assert.equal(limiter.consume("a"), true);
  assert.equal(limiter.consume("a"), false);
  assert.equal(limiter.consume("b"), true);
});
