import type { Database } from "@my-better-t-app/db";

import type { GithubClient } from "./github-client";
import type { ProfileReader } from "./profile-reader";
import type { RateLimiter } from "./rate-limit";

export type Context = {
  /** Writes (and the existence checks around them) still go through Prisma. */
  db: Database;
  /** Profile list reads: Prisma, or the Go service when GO_API_URL is set. */
  profiles: ProfileReader;
  github: GithubClient;
  rateLimiter: RateLimiter;
  /** Peer address of the connection; null when the runtime cannot provide one. */
  clientIp: string | null;
};
