import type { GithubClient } from "./github-client";
import type { ProfileStore } from "./profile-store";
import type { RateLimiter } from "./rate-limit";

export type Context = {
  /** All github_profile reads and writes: Prisma, or the Go service when GO_API_URL is set. */
  profiles: ProfileStore;
  github: GithubClient;
  rateLimiter: RateLimiter;
  /** Peer address of the connection; null when the runtime cannot provide one. */
  clientIp: string | null;
};
