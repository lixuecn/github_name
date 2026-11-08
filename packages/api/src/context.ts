import type { Database } from "@my-better-t-app/db";

import type { GithubClient } from "./github-client";
import type { RateLimiter } from "./rate-limit";

export type Context = {
  db: Database;
  github: GithubClient;
  rateLimiter: RateLimiter;
  /** Peer address of the connection; null when the runtime cannot provide one. */
  clientIp: string | null;
};
