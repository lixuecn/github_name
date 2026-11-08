import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@my-better-t-app/api/routers/index";
import { type Context as HonoContext, Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext, type ServiceDeps } from "./context";
import { ENV } from "./env.server";
import { services } from "./services";

const IPV4_MAPPED_PREFIX = "::ffff:";

export type GetClientIp = (context: HonoContext) => string | undefined;

function normalizeIp(address: string | undefined): string | null {
	if (!address) {
		return null;
	}
	return address.startsWith(IPV4_MAPPED_PREFIX)
		? address.slice(IPV4_MAPPED_PREFIX.length)
		: address;
}

/**
 * `getClientIp` must read the runtime's peer address (socket / API Gateway
 * sourceIp), never client-supplied headers, so rate limits cannot be spoofed.
 */
export function createApp(getClientIp: GetClientIp, deps: ServiceDeps = services) {
	const app = new Hono();

	app.use(logger());
	app.use(
		"/*",
		cors({
			allowHeaders: ["Content-Type"],
			allowMethods: ["GET", "POST", "OPTIONS"],
			origin: ENV.CORS_ORIGIN,
		})
	);

	app.use(
		"/trpc/*",
		trpcServer({
			createContext: (_opts, context) =>
				createContext(deps, normalizeIp(getClientIp(context))),
			endpoint: "/trpc",
			router: appRouter,
		})
	);

	app.get("/", (c) => c.text("OK"));

	return app;
}
