import { getConnInfo } from "@hono/node-server/conninfo";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@my-better-t-app/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth } from "./services";

const IPV4_MAPPED_PREFIX = "::ffff:";

// Act like a proxy hop: append the socket peer to x-forwarded-for so Better Auth
// can rate-limit per client. It trusts loopback hops only, so spoofed values from
// remote clients are ignored.
function withClientIp(request: Request, peerAddress: string | undefined): Request {
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

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) =>
  auth.handler(withClientIp(c.req.raw, getConnInfo(c).remote.address)),
);

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/trpc",
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
