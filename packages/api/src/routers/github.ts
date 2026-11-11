import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GithubError, type GithubUser } from "../github-client";
import { publicProcedure, rateLimitedProcedure, router } from "../index";
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

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

const isUniqueViolation = (error: unknown) => hasPrismaCode(error, "P2002");
const isRecordMissing = (error: unknown) => hasPrismaCode(error, "P2025");

/** GitHub-owned columns; system fields (note, tags) are never included. */
function profileDataFromGithub(user: GithubUser) {
  return {
    githubId: user.githubId,
    login: user.login,
    name: user.name,
    bio: user.bio,
    company: user.company,
    location: user.location,
    blog: user.blog,
    twitterUsername: user.twitterUsername,
    avatarUrl: user.avatarUrl,
    htmlUrl: user.htmlUrl,
    publicRepos: user.publicRepos,
    followers: user.followers,
    following: user.following,
    githubCreatedAt: user.githubCreatedAt,
  };
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
      const existing = await ctx.db.githubProfile.findUnique({
        where: { githubId: user.githubId },
        select: { id: true },
      });
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

      const existing = await ctx.db.githubProfile.findUnique({
        where: { githubId: user.githubId },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: PROFILE_EXISTS });
      }

      try {
        return await ctx.db.githubProfile.create({
          data: {
            ...profileDataFromGithub(user),
            note: input.note ?? null,
            tags: [],
            syncedAt: new Date(),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
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
      const data: { note?: string | null; tags?: string[] } = {};
      if (input.note !== undefined) {
        data.note = input.note;
      }
      if (input.tags !== undefined) {
        data.tags = input.tags;
      }
      try {
        return await ctx.db.githubProfile.update({ where: { id: input.id }, data });
      } catch (error) {
        if (isRecordMissing(error)) {
          throw new TRPCError({ code: "NOT_FOUND", message: PROFILE_NOT_FOUND, cause: error });
        }
        throw error;
      }
    }),

  sync: rateLimitedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    const profile = await ctx.db.githubProfile.findUnique({
      where: { id: input.id },
      select: { githubId: true },
    });
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
      return await ctx.db.githubProfile.update({
        where: { id: input.id },
        data: { ...profileDataFromGithub(user), syncedAt: new Date() },
      });
    } catch (error) {
      if (isRecordMissing(error)) {
        throw new TRPCError({ code: "NOT_FOUND", message: PROFILE_NOT_FOUND, cause: error });
      }
      throw error;
    }
  }),

  delete: rateLimitedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    try {
      await ctx.db.githubProfile.delete({ where: { id: input.id } });
      return { id: input.id };
    } catch (error) {
      if (isRecordMissing(error)) {
        throw new TRPCError({ code: "NOT_FOUND", message: PROFILE_NOT_FOUND, cause: error });
      }
      throw error;
    }
  }),
});
