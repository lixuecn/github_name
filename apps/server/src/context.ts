import type { Context as ApiContext } from "@my-better-t-app/api/context";

export type ServiceDeps = Pick<ApiContext, "db" | "github" | "rateLimiter">;

export function createContext(deps: ServiceDeps, clientIp: string | null): ApiContext {
	return { ...deps, clientIp };
}
