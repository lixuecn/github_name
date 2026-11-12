import { createGithubClient } from "@my-better-t-app/api/github-client";
import {
	createGoApiProfileStore,
	createPrismaProfileStore,
	type ProfileStore,
} from "@my-better-t-app/api/profile-store";
import { createRateLimiter } from "@my-better-t-app/api/rate-limit";
import { createPrismaClient } from "@my-better-t-app/db";

import type { ServiceDeps } from "./context";
import { ENV } from "./env.server";

const RATE_LIMIT_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * With GO_API_URL set, every github_profile read and write goes to the internal
 * Go service and no Prisma client is created. Without it (local development)
 * the backend talks to PostgreSQL directly through Prisma.
 */
function createProfileStore(): ProfileStore {
	if (ENV.GO_API_URL) {
		return createGoApiProfileStore({ baseUrl: ENV.GO_API_URL });
	}
	return createPrismaProfileStore(createPrismaClient(ENV));
}

export const services: ServiceDeps = {
	github: createGithubClient({ token: ENV.GITHUB_TOKEN }),
	profiles: createProfileStore(),
	rateLimiter: createRateLimiter({
		limit: RATE_LIMIT_PER_WINDOW,
		windowMs: RATE_LIMIT_WINDOW_MS,
	}),
};
