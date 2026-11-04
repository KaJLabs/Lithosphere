import { afterEach, expect, it, vi } from 'vitest';
import { metricDeadline } from '../metric-deadline.js';
afterEach(() => { vi.useRealTimers(); });
it('bounds a stalled count and still allows its cache refresh to complete', async () => {
  vi.useFakeTimers();
  let complete!: (value: number) => void;
  const work = new Promise<number>(resolve => { complete = resolve; });
  const result = metricDeadline(work, 100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBeNull();
  complete(45);
  expect(await work).toBe(45);
});
it('isolates failures while retaining valid zeroes', async () => {
  expect(await metricDeadline(Promise.reject(new Error('timeout')))).toBeNull();
  expect(await metricDeadline(Promise.resolve(0))).toBe(0);
});
