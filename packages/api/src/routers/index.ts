import { protectedProcedure, publicProcedure, router } from "../index";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "这是受保护的数据",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;
