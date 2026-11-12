import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GithubError, type GithubUser } from "../github-client";
import { publicProcedure, rateLimitedProcedure, router } from "../index";
import { ProfileConflictError, ProfileNotFoundError } from "../profile-store";
import {
  githubSortSchema,
  githubUsernameSchema,
  noteSchema,
  PAGE_SIZE,
  PAGE_SIZE_MAX,
  tagsSchema,
} from "../shared/github";

const PROFILE_NOT_FOUND = "该人员不存在";
const PROFILE_EXISTS = "该用户已在系统中";

type GithubErrorMessages = { notFound: string };

/** Maps GitHub client failures to tRPC errors with user-facing messages. */
function toTrpcError(error: unknown, messages: GithubErrorMessages): TRPCError {
  if (error instanceof GithubError) {
    if (error.kind === "not_found") {
      return new TRPCError({ code: "NOT_FOUND", message: messages.notFound, cause: error });
    }
    if (error.kind === "rate_limited") {
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "GitHub 请求过于频繁，请稍后再试",
        cause: error,
      });
    }
  }
  return new TRPCError({ code: "BAD_GATEWAY", message: "查询失败，请稍后重试", cause: error });
}

/** Turns a store "unknown id" into the user-facing NOT_FOUND; rethrows anything else. */
function rethrowNotFound(error: unknown): never {
  if (error instanceof ProfileNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: PROFILE_NOT_FOUND, cause: error });
  }
  throw error;
}

const idSchema = z.string().min(1);

export const githubRouter = router({
  search: rateLimitedProcedure
    .input(z.object({ username: githubUsernameSchema }))
    .query(async ({ ctx, input }) => {
      let user: GithubUser;
      try {
        user = await ctx.github.getUserByLogin(input.username);
      } catch (error) {
        throw toTrpcError(error, { notFound: "未找到该 GitHub 用户" });
      }
      const existing = await ctx.profiles.findByGithubId(user.githubId);
      return { ...user, existsInSystem: existing !== null };
    }),

  list: publicProcedure
    .input(
      z.object({
        keyword: z.string().trim().max(100).optional(),
        sort: githubSortSchema.default("createdAt"),
        cursor: z.string().nullish(),
        limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE),
      })
    )
    .query(({ ctx, input }) =>
      ctx.profiles.list({
        keyword: input.keyword ?? "",
        sort: input.sort,
        cursor: input.cursor ?? null,
        limit: input.limit,
      })
    ),

  create: rateLimitedProcedure
    .input(z.object({ username: githubUsernameSchema, note: noteSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      let user: GithubUser;
      try {
        // Never persist a cached search result: re-fetch from GitHub before inserting.
        user = await ctx.github.getUserByLogin(input.username, { fresh: true });
      } catch (error) {
        throw toTrpcError(error, { notFound: "未找到该 GitHub 用户" });
      }

      if (await ctx.profiles.findByGithubId(user.githubId)) {
        throw new TRPCError({ code: "CONFLICT", message: PROFILE_EXISTS });
      }

      try {
        return await ctx.profiles.create({ ...user, note: input.note ?? null });
      } catch (error) {
        // A concurrent create can still win the race between check and insert.
        if (error instanceof ProfileConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: PROFILE_EXISTS, cause: error });
        }
        throw error;
      }
    }),

  update: rateLimitedProcedure
    .input(
      z.object({
        id: idSchema,
        note: noteSchema.nullable().optional(),
        tags: tagsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const patch: { note?: string | null; tags?: string[] } = {};
      if (input.note !== undefined) {
        patch.note = input.note;
      }
      if (input.tags !== undefined) {
        patch.tags = input.tags;
      }
      try {
        return await ctx.profiles.update(input.id, patch);
      } catch (error) {
        return rethrowNotFound(error);
      }
    }),

  sync: rateLimitedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    const profile = await ctx.profiles.get(input.id);
    if (!profile) {
      throw new TRPCError({ code: "NOT_FOUND", message: PROFILE_NOT_FOUND });
    }

    let user: GithubUser;
    try {
      user = await ctx.github.getUserById(profile.githubId);
    } catch (error) {
      throw toTrpcError(error, { notFound: "该 GitHub 用户已不存在" });
    }

    try {
      return await ctx.profiles.syncGithub(input.id, user);
    } catch (error) {
      return rethrowNotFound(error);
    }
  }),

  delete: rateLimitedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    try {
      await ctx.profiles.delete(input.id);
      return { id: input.id };
    } catch (error) {
      return rethrowNotFound(error);
    }
  }),
});
