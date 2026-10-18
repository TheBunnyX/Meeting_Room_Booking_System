import { getConfig } from "../config";
import { db } from "../db";

/**
 * Sliding-window limit on failed attempts. Serverless instances share no memory, so every
 * attempt is stored in Postgres and all instances see the same counts.
 */
export class RateLimiter {
  constructor(
    private readonly bucket: string,
    private readonly maxAttempts: () => number,
    private readonly windowSeconds: () => number,
  ) {}

  private since(now: number) {
    return new Date(now - this.windowSeconds() * 1000);
  }

  /** Seconds the caller must wait, or 0 when another attempt is allowed. */
  async retryAfter(key: string): Promise<number> {
    const now = Date.now();
    const max = this.maxAttempts();
    const events = await db.rateLimitEvent.findMany({
      where: { bucket: this.bucket, key, createdAt: { gt: this.since(now) } },
      orderBy: { createdAt: "asc" },
      take: max,
      select: { createdAt: true },
    });
    if (events.length < max) return 0;
    return Math.max(1, Math.ceil(this.windowSeconds() - (now - events[0].createdAt.getTime()) / 1000));
  }

  async recordFailure(key: string) {
    await db.rateLimitEvent.create({ data: { bucket: this.bucket, key } });
    // Expired events are useless; drop this key's so the table stays small.
    await db.rateLimitEvent.deleteMany({
      where: { bucket: this.bucket, key, createdAt: { lte: this.since(Date.now()) } },
    });
  }

  async reset(key: string) {
    await db.rateLimitEvent.deleteMany({ where: { bucket: this.bucket, key } });
  }

  async clear() {
    await db.rateLimitEvent.deleteMany({ where: { bucket: this.bucket } });
  }
}

export const loginLimiter = new RateLimiter(
  "login",
  () => getConfig().loginMaxAttempts,
  () => getConfig().loginWindowMinutes * 60,
);
// Every reset request counts, so the form cannot be used to flood administrators.
export const forgotPasswordLimiter = new RateLimiter("forgot", () => 3, () => getConfig().loginWindowMinutes * 60);
