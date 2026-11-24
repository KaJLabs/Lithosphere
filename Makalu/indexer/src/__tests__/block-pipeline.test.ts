import { describe, expect, it, vi } from 'vitest';
import { consumePrefetchedRange } from '../block-pipeline.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('ordered block pipeline', () => {
  it('overlaps RPC reads while keeping block writes and checkpoints in height order', async () => {
    const reads = new Map([101, 102, 103, 104].map(h => [h, deferred<string>()]));
    const started: number[] = [];
    const written: number[] = [];
    const checkpoint: number[] = [];
    const firstWrite = deferred<void>();
    const run = consumePrefetchedRange(101, 104, 3, async h => {
      started.push(h);
      return reads.get(h)!.promise;
    }, async (h, value) => {
      expect(value).toBe(`block-${h}`);
      written.push(h);
      if (h === 101) await firstWrite.promise;
      checkpoint.push(h);
    });
    await vi.waitFor(() => expect(started).toEqual([101, 102, 103]));
    // Later reads may complete first, but must not advance the cursor.
    reads.get(103)!.resolve('block-103');
    reads.get(102)!.resolve('block-102');
    expect(written).toEqual([]);
    reads.get(101)!.resolve('block-101');
    await vi.waitFor(() => expect(started).toEqual([101, 102, 103, 104]));
    expect(written).toEqual([101]);
    expect(checkpoint).toEqual([]);
    reads.get(104)!.resolve('block-104');
    firstWrite.resolve();
    await run;
    expect(written).toEqual([101, 102, 103, 104]);
    expect(checkpoint).toEqual(written);
  });

  it('never writes or checkpoints beyond a failed read, even when later reads succeed', async () => {
    const written: number[] = [];
    await expect(consumePrefetchedRange(10, 15, 3, async h => {
      if (h === 11) throw new Error('receipt RPC unavailable');
      return h;
    }, async h => { written.push(h); })).rejects.toThrow('receipt RPC unavailable');
    expect(written).toEqual([10]);
  });

  it('bounds outstanding reads and stops at a failed database write', async () => {
    const first = deferred<number>();
    const started: number[] = [];
    const writes: number[] = [];
    const run = consumePrefetchedRange(1, 100, 4, async h => {
      started.push(h);
      if (h === 1) return first.promise;
      // Rejections in abandoned lookahead reads must also be handled.
      if (h === 5) throw new Error('later RPC failure');
      return h;
    }, async h => {
      writes.push(h);
      throw new Error('database write failed');
    });
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3, 4]));
    const verdict = expect(run).rejects.toThrow('database write failed');
    first.resolve(1);
    await verdict;
    expect(writes).toEqual([1]);
    expect(started).toEqual([1, 2, 3, 4, 5]);
  });
});
