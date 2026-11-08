const PRUNE_THRESHOLD = 10_000;

export type RateLimiter = {
  /** Records one hit for `key`; returns false when the key is over its limit. */
  consume: (key: string) => boolean;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

/** Fixed-window, in-memory counter. Each process keeps its own counts. */
export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function prune(current: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) {
        buckets.delete(key);
      }
    }
  }

  return {
    consume(key) {
      const current = now();
      if (buckets.size >= PRUNE_THRESHOLD) {
        prune(current);
      }
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= limit;
    },
  };
}
