import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@my-better-t-app/api/routers/index";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth } from "./services";

const IPV4_MAPPED_PREFIX = "::ffff:";

// Act like a proxy hop: append the socket peer to x-forwarded-for so Better Auth
// can rate-limit per client. It trusts loopback hops only, so spoofed values from
// remote clients are ignored.
function withClientIp(
	request: Request,
	peerAddress: string | undefined
): Request {
	if (!peerAddress) {
		return request;
	}
	const peer = peerAddress.startsWith(IPV4_MAPPED_PREFIX)
		? peerAddress.slice(IPV4_MAPPED_PREFIX.length)
		: peerAddress;
	const headers = new Headers(request.headers);
	const forwarded = headers.get("x-forwarded-for");
	headers.set("x-forwarded-for", forwarded ? `${forwarded}, ${peer}` : peer);
	return new Request(request, { headers });
}

export function createApp(
	getPeerAddress: (context: Context) => string | undefined
) {
	const app = new Hono();

	app.use(logger());
	app.use(
		"/*",
		cors({
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["GET", "POST", "OPTIONS"],
			credentials: true,
			origin: ENV.CORS_ORIGIN,
		})
	);

	app.on(["POST", "GET"], "/api/auth/*", async (c) =>
		auth.handler(withClientIp(c.req.raw, getPeerAddress(c)))
	);

	app.use(
		"/trpc/*",
		trpcServer({
			createContext: (_opts, context) => createContext({ context }),
			endpoint: "/trpc",
			router: appRouter,
		})
	);

	app.get("/", (c) => c.text("OK"));

	return app;
}
