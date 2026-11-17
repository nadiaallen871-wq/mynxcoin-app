/**
 * Redis store for express-rate-limit, so limits hold across multiple API
 * instances and restarts. Fixed window: INCR, plus PEXPIRE on the first hit.
 * Each limiter needs its own store instance (express-rate-limit enforces this).
 */
export class RedisRateLimitStore {
  constructor({ client, prefix }) {
    this.client = client;
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(k) {
    return `${this.prefix}${k}`;
  }

  async get(k) {
    const [[, hits], [, ttl]] = await this.client.multi().get(this.key(k)).pttl(this.key(k)).exec();
    if (hits === null) return undefined;
    return { totalHits: Number(hits), resetTime: new Date(Date.now() + Math.max(ttl, 0)) };
  }

  async increment(k) {
    const key = this.key(k);
    const [[, hits], [, ttl]] = await this.client.multi().incr(key).pttl(key).exec();
    let remaining = ttl;
    if (ttl < 0) {
      await this.client.pexpire(key, this.windowMs);
      remaining = this.windowMs;
    }
    return { totalHits: Number(hits), resetTime: new Date(Date.now() + remaining) };
  }

  async decrement(k) {
    await this.client.decr(this.key(k));
  }

  async resetKey(k) {
    await this.client.del(this.key(k));
  }
}
