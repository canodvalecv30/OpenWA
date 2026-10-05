import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage';

// Runs the throttler's Lua script against a real Redis: the unit spec mocks eval, so a wrong ARGV
// index or a repair branch that is never taken would pass there, and increment() fails open on a
// script error, which only logs. Gated on Redis the same way as queue-on.e2e-spec.ts: a developer
// box without one skips, GitHub Actions (which provides one) fails instead of skipping.
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const probeRedis = (host: string, port: number, timeoutMs: number): boolean => {
  const script =
    `const s = require('net').connect(${port}, ${JSON.stringify(host)});` +
    `const t = setTimeout(() => process.exit(2), ${timeoutMs});` +
    `s.on('connect', () => { clearTimeout(t); s.end(); process.exit(0); });` +
    `s.on('error', () => { clearTimeout(t); process.exit(1); });`;
  return spawnSync(process.execPath, ['-e', script], { timeout: timeoutMs + 1000 }).status === 0;
};

const REDIS_AVAILABLE = probeRedis(REDIS_HOST, REDIS_PORT, 1000);
if (!REDIS_AVAILABLE && process.env.GITHUB_ACTIONS === 'true') {
  throw new Error(`throttler e2e: no Redis at ${REDIS_HOST}:${REDIS_PORT} under GitHub Actions; refusing to skip`);
}
const describeWithRedis = REDIS_AVAILABLE ? describe : describe.skip;

describeWithRedis('RedisThrottlerStorage against a real Redis', () => {
  const TTL_MS = 5000;
  const LIMIT = 2;
  const throttler = `e2e-${randomUUID()}`;
  const keyOf = (key: string): string => `openwa:throttle:${throttler}:${key}`;
  let redis: Redis;
  let storage: RedisThrottlerStorage;
  let warn: jest.SpyInstance;

  beforeAll(() => {
    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: 1 });
    storage = new RedisThrottlerStorage(redis);
    warn = jest.spyOn((storage as unknown as { logger: { warn: () => void } }).logger, 'warn');
  });

  afterEach(async () => {
    // A script error is swallowed by the fail-open path; this is where it would show.
    expect(warn).not.toHaveBeenCalled();
    const keys = await redis.keys(keyOf('*'));
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await storage.onModuleDestroy();
  });

  it('arms the window TTL on the first hit', async () => {
    const record = await storage.increment('first', TTL_MS, LIMIT, 60_000, throttler);

    expect(record).toEqual({ totalHits: 1, timeToExpire: 5, isBlocked: false, timeToBlockExpire: 0 });
    const pttl = await redis.pttl(keyOf('first'));
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL_MS);
  });

  it('resets a counter left without a TTL to a fresh first hit and arms its TTL', async () => {
    await redis.set(keyOf('legacy'), 999);

    const record = await storage.increment('legacy', TTL_MS, LIMIT, 60_000, throttler);

    expect(record).toEqual({ totalHits: 1, timeToExpire: 5, isBlocked: false, timeToBlockExpire: 0 });
    expect(await redis.get(keyOf('legacy'))).toBe('1');
    expect(await redis.pttl(keyOf('legacy'))).toBeGreaterThan(0);
  });

  it('blocks past the limit until the window expires, without extending it', async () => {
    for (let i = 0; i < LIMIT; i++) await storage.increment('busy', TTL_MS, LIMIT, 60_000, throttler);

    const record = await storage.increment('busy', TTL_MS, LIMIT, 60_000, throttler);
    const pttl = await redis.pttl(keyOf('busy'));

    expect(record.totalHits).toBe(LIMIT + 1);
    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBeGreaterThanOrEqual(Math.ceil(pttl / 1000));
    expect(record.timeToBlockExpire).toBeLessThanOrEqual(TTL_MS / 1000);
    expect(pttl).toBeGreaterThan(0);
  });
});
