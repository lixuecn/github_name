import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

const UNKNOWN_CLIENT = "unknown";

/** Shares one per-IP budget across every procedure built on it. */
export const rateLimitedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.rateLimiter.consume(ctx.clientIp ?? UNKNOWN_CLIENT)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "请求过于频繁，请稍后再试",
    });
  }
  return next();
});
