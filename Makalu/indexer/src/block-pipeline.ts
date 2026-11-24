type Prepared<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Overlap read-only RPC work; consume and checkpoint strictly in block order. */
export async function consumePrefetchedRange<T>(
  from: number,
  to: number,
  concurrency: number,
  prepare: (height: number) => Promise<T>,
  consume: (height: number, prepared: T) => Promise<void>,
): Promise<void> {
  const limit = Math.min(4, Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1));
  const pending = new Map<number, Promise<Prepared<T>>>();
  let next = from;
  const enqueue = () => {
    if (next > to) return;
    const height = next++;
    // Capture failures immediately, including reads abandoned after an earlier
    // block fails. Only consume() may write, so lookahead cannot skip a cursor.
    pending.set(height, Promise.resolve().then(() => prepare(height)).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    ));
  };
  for (let i = 0; i < limit; i++) enqueue();
  for (let height = from; height <= to; height++) {
    const result = await pending.get(height)!;
    pending.delete(height);
    if (!result.ok) throw result.error;
    enqueue();
    await consume(height, result.value);
  }
}
