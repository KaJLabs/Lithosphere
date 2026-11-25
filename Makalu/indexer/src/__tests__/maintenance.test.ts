import { describe, expect, it, vi } from 'vitest';
import { createMaintenanceScheduler, consistencyWindowSql, nextAuditWindow } from '../maintenance.js';
import { consumePrefetchedRange } from '../block-pipeline.js';

describe('maintenance alongside ordered ingestion', () => {
  it('keeps committing blocks while slow maintenance is pending, without overlapping that job', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const scan = vi.fn(() => blocked);
    const scheduler = createMaintenanceScheduler([{ name: 'integrity', intervalMs: 300_000, run: scan }]);
    const writes: number[] = [];
    scheduler.tick(300_000);
    await consumePrefetchedRange(101, 105, 4, async h => h, async h => {
      writes.push(h);
      scheduler.tick(600_000);
    });
    expect(writes).toEqual([101, 102, 103, 104, 105]);
    expect(scan).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(scheduler.running()).toBe(0));
    scheduler.tick(600_001);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
  });

  it('isolates failed jobs and reports duration without unhandled rejections', async () => {
    const report = vi.fn();
    const healthy = vi.fn();
    const error = new Error('maintenance timeout');
    const scheduler = createMaintenanceScheduler([
      { name: 'stats', intervalMs: 10, run: async () => { throw error; } },
      { name: 'snapshot', intervalMs: 10, run: healthy },
    ], report);
    scheduler.tick(10);
    await vi.waitFor(() => expect(scheduler.running()).toBe(0));
    expect(healthy).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('stats', expect.any(Number), error);
    scheduler.tick(20);
    await vi.waitFor(() => expect(healthy).toHaveBeenCalledTimes(2));
  });
});

describe('bounded integrity audit', () => {
  it('checks history in bounded windows and wraps only at the captured committed tip', () => {
    expect(nextAuditWindow(0, 15_300_000, 10_000)).toEqual({ from: 1, to: 10_000, next: 10_000, complete: false });
    expect(nextAuditWindow(15_295_000, 15_300_000, 10_000)).toEqual({ from: 15_295_001, to: 15_300_000, next: 0, complete: true });
    expect(nextAuditWindow(999, 50, 10_000)).toEqual({ from: 1, to: 50, next: 0, complete: true });
    expect(nextAuditWindow(0, 0, 10_000)).toBeNull();
  });

  it('bounds both transaction aggregation and block reads, including orphan transactions and chain scope', () => {
    for (const chain of [undefined, 'lithosphere_9005-1']) {
      const sql = consistencyWindowSql(chain);
      expect(sql).toContain('block_height BETWEEN $1 AND $2');
      expect(sql).toContain('b.height BETWEEN $1 AND $2');
      expect(sql).toContain('FULL OUTER JOIN');
      expect(sql).toContain(chain ? 'transaction_inclusions' : 'transactions');
      if (chain) expect(sql).toContain('chain_id = $3');
    }
  });
});
