import type { AppRouter } from "@my-better-t-app/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<AppRouter>;

export type GithubProfile = Outputs["github"]["list"]["items"][number];
export type GithubSearchResult = Outputs["github"]["search"];
