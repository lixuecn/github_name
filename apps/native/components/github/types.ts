import type { AppRouter } from "@my-better-t-app/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

export type GithubProfile = inferRouterOutputs<AppRouter>["github"]["list"]["items"][number];
