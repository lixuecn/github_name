import { createGithubClient } from "@my-better-t-app/api/github-client";
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
	rateLimiter: createRateLimiter({
		limit: RATE_LIMIT_PER_WINDOW,
		windowMs: RATE_LIMIT_WINDOW_MS,
	}),
};
