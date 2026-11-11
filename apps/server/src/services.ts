import { createGithubClient } from "@my-better-t-app/api/github-client";
import {
	createGoApiProfileReader,
	createPrismaProfileReader,
} from "@my-better-t-app/api/profile-reader";
import { createRateLimiter } from "@my-better-t-app/api/rate-limit";
import { createPrismaClient } from "@my-better-t-app/db";

import type { ServiceDeps } from "./context";
import { ENV } from "./env.server";

const RATE_LIMIT_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const db = createPrismaClient(ENV);

export const services: ServiceDeps = {
	db,
	github: createGithubClient({ token: ENV.GITHUB_TOKEN }),
	// With GO_API_URL set, list reads go to the internal Go service; otherwise
	// they stay on Prisma, so local dev and existing deployments are unchanged.
	profiles: ENV.GO_API_URL
		? createGoApiProfileReader({ baseUrl: ENV.GO_API_URL })
		: createPrismaProfileReader(db),
	rateLimiter: createRateLimiter({
		limit: RATE_LIMIT_PER_WINDOW,
		windowMs: RATE_LIMIT_WINDOW_MS,
	}),
};
