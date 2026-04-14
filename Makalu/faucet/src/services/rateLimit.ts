import Redis from 'ioredis';
import { config } from '../config.js';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.error('[faucet] Redis error:', err.message);
    });
  }
  return redis;
}

const KEY_PREFIX = 'faucet:cooldown:';
const LEGACY_NATIVE_KEY_PREFIX = 'faucet:cooldown:';

function getCooldownKey(address: string, assetId: string): string {
  return `${KEY_PREFIX}${assetId.toLowerCase()}:${address.toLowerCase()}`;
}

function getLegacyNativeKey(address: string): string {
  return `${LEGACY_NATIVE_KEY_PREFIX}${address.toLowerCase()}`;
}

/**
 * Check if an address is on cooldown. Does NOT set the cooldown.
 * Call setCooldown() only after a successful drip.
 */
export async function checkCooldown(address: string, assetId = 'litho'): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = getCooldownKey(address, assetId);
  const r = getRedis();

  try {
    await r.ping(); // ensure connected
  } catch {
    // Redis unavailable — allow the request (graceful degradation)
    console.warn('[faucet] Redis unavailable — skipping cooldown check');
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const [ttl, legacyTtl] = await Promise.all([
    r.ttl(key),
    assetId === 'litho' ? r.ttl(getLegacyNativeKey(address)) : Promise.resolve(-1),
  ]);
  const retryAfterSeconds = Math.max(ttl, legacyTtl);

  if (retryAfterSeconds > 0) {
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Record a successful drip — sets the cooldown timer.
 * Only call this AFTER drip() succeeds.
 */
export async function setCooldown(address: string, assetId = 'litho'): Promise<void> {
  const key = getCooldownKey(address, assetId);
  const r = getRedis();

  try {
    const cooldownSeconds = config.cooldownHours * 3600;
    const operations: Array<Promise<unknown>> = [
      r.set(key, Date.now().toString(), 'EX', cooldownSeconds),
    ];

    if (assetId === 'litho') {
      operations.push(
        r.set(getLegacyNativeKey(address), Date.now().toString(), 'EX', cooldownSeconds),
      );
    }

    await Promise.all(operations);
  } catch (err) {
    console.error('[faucet] Failed to set cooldown:', err);
  }
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
