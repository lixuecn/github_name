import assert from "node:assert/strict";
import { test } from "node:test";

import { githubUsernameSchema, noteSchema, tagsSchema } from "@my-better-t-app/api/shared/github";

test("githubUsernameSchema accepts valid usernames and trims them", () => {
  for (const name of ["a", "torvalds", "a-b-c", "A1", "x".repeat(39)]) {
    assert.equal(githubUsernameSchema.parse(name), name);
  }
  assert.equal(githubUsernameSchema.parse("  octocat "), "octocat");
});

test("githubUsernameSchema rejects invalid usernames with the Chinese message", () => {
  for (const name of ["", "   ", "-abc", "abc-", "a_b", "a b", "x".repeat(40), "中文"]) {
    const result = githubUsernameSchema.safeParse(name);
    assert.equal(result.success, false, name);
    assert.equal(result.error?.issues[0]?.message, "GitHub 用户名格式不正确");
  }
});

test("noteSchema trims, turns empty into null and enforces 200 chars", () => {
  assert.equal(noteSchema.parse("  hi  "), "hi");
  assert.equal(noteSchema.parse("   "), null);
  assert.equal(noteSchema.parse("x".repeat(200)), "x".repeat(200));
  assert.equal(noteSchema.safeParse("x".repeat(201)).success, false);
});

test("tagsSchema trims, removes empty and duplicate tags, enforces limits", () => {
  assert.deepEqual(tagsSchema.parse([" 前端 ", "前端", "", "后端"]), ["前端", "后端"]);
  assert.deepEqual(tagsSchema.parse(["a", "b", "c", "d", "e", "a"]), ["a", "b", "c", "d", "e"]);
  assert.equal(tagsSchema.safeParse(["a", "b", "c", "d", "e", "f"]).success, false);
  assert.equal(tagsSchema.safeParse(["x".repeat(20)]).success, true);
  assert.equal(tagsSchema.safeParse(["x".repeat(21)]).success, false);
});
