const cache = new Map<string, { value: string | null; expires: number }>();
const pending = new Map<string, Promise<string | null>>();

/** First-party Ignite asset, pinned locally so profile rendering does not
 * depend on an external discovery service. Symbols never grant identity. */
export function officialTokenIcon(address: string, chainId: number): string | null {
  const lax = chainId === 9005 ? '0x29147bebb1c49c3a54aa464137611fe708886df3'
    : chainId === 700777 ? '0x1cde2ca6c2ab8622003ebe06e382bc07850d4b8d' : null;
  return lax && address.toLowerCase() === lax ? '/tokens/lax.png' : null;
}

export function selectDegensIcon(items: unknown, address: string, chainId: number): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || item.chainId !== chainId || typeof item.tokenAddress !== 'string'
        || item.tokenAddress.toLowerCase() !== address.toLowerCase() || typeof item.logoUrl !== 'string') continue;
    try {
      const url = new URL(item.logoUrl);
      if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048) return url.href;
    } catch { /* Missing or invalid icon; use the explorer fallback. */ }
  }
  return null;
}

/** Degens search is by token name/symbol. Always match chain and contract again;
 * a matching symbol alone never identifies a token or grants verification. */
export async function findDegensIcon(address: string, chainId: number, symbol: string): Promise<string | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const entry = cache.get(key); if (entry && entry.expires > Date.now()) return entry.value;
  const running = pending.get(key); if (running) return running;
  const task = (async () => {
    let value: string | null = null;
    try {
      const url = new URL('https://degens.lt/v1/discover');
      url.searchParams.set('q', symbol.slice(0, 100)); url.searchParams.set('limit', '48');
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const body = await response.text();
        if (body.length <= 524288) value = selectDegensIcon(JSON.parse(body).items, address, chainId);
      }
    } catch { /* An icon lookup must not break the token page. */ }
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + (value ? 600_000 : 60_000) });
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key, task); return task;
}

export function isOfficialToken(address: string, chainId: number): boolean {
  return chainId === 9005 && address.toLowerCase() === '0x29147bebb1c49c3a54aa464137611fe708886df3';
}
