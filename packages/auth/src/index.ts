import { expo } from "@better-auth/expo";
import type { Database } from "@my-better-t-app/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";

import {
  isValidUsername,
  toPlaceholderEmail,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "./username";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

const AUTH_RATE_LIMIT_WINDOW_SECONDS = 60;
const AUTH_RATE_LIMIT_MAX_REQUESTS = 5;

// Accounts are username-only: sign-up must carry a username, and the email
// Better Auth requires is always derived from it so clients cannot pick one.
const requireUsernameOnSignUp = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-up/email") {
    return;
  }
  const requested: unknown = ctx.body?.username;
  if (typeof requested !== "string" || !isValidUsername(requested)) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_USERNAME",
      message: "Username is invalid",
    });
  }
  return {
    context: {
      body: { ...ctx.body, email: toPlaceholderEmail(requested) },
    },
  };
});

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: prismaAdapter(database, {
      provider: "postgresql",
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      "my-better-t-app://",
      "exp://",
      "http://localhost:8081",
    ],
    emailAndPassword: { enabled: true },
    // Username is the only sign-in method; placeholder emails must not log in.
    disabledPaths: ["/sign-in/email"],
    rateLimit: {
      enabled: true,
      customRules: {
        "/sign-up/email": {
          window: AUTH_RATE_LIMIT_WINDOW_SECONDS,
          max: AUTH_RATE_LIMIT_MAX_REQUESTS,
        },
        "/sign-in/username": {
          window: AUTH_RATE_LIMIT_WINDOW_SECONDS,
          max: AUTH_RATE_LIMIT_MAX_REQUESTS,
        },
      },
    },
    hooks: {
      before: requireUsernameOnSignUp,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      ipAddress: {
        // The Hono server appends the socket peer as the last hop (see apps/server/src/index.ts).
        trustedProxies: ["127.0.0.0/8", "::1/128"],
      },
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      expo(),
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: (value) => USERNAME_PATTERN.test(value),
        // The placeholder email is derived from the username, so renames would desync them.
        immutableUsername: true,
      }),
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
