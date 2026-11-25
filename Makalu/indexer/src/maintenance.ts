export interface MaintenanceJob {
  name: string;
  intervalMs: number;
  run: () => unknown | Promise<unknown>;
}

/** Start due work without lending ingestion's control flow to it. Each job has
 * one in-flight promise, including when it takes longer than its interval. */
export function createMaintenanceScheduler(
  jobs: MaintenanceJob[],
  report: (name: string, durationMs: number, error?: unknown) => void = () => {},
) {
  const state = jobs.map(job => ({ job, started: 0, running: false }));
  return {
    tick(now = Date.now()): void {
      for (const entry of state) {
        if (entry.running || now - entry.started < entry.job.intervalMs) continue;
        entry.running = true;
        entry.started = now;
        const start = Date.now();
        void Promise.resolve().then(entry.job.run).then(
          () => report(entry.job.name, Date.now() - start),
          error => report(entry.job.name, Date.now() - start, error),
        ).finally(() => { entry.running = false; }).catch(() => {});
      }
    },
    running: () => state.filter(entry => entry.running).length,
  };
}

export function nextAuditWindow(cursor: number, committedTip: number, size: number) {
  if (committedTip < 1) return null;
  const from = cursor < committedTip ? Math.max(1, cursor + 1) : 1;
  const to = Math.min(committedTip, from + Math.max(1, size) - 1);
  const complete = to === committedTip;
  return { from, to, next: complete ? 0 : to, complete };
}

/** LIMIT on mismatches does not bound a GROUP BY over the whole chain. Apply
 * the height range to both inputs first, using their block-height indexes. */
export function consistencyWindowSql(chainId?: string): string {
  return `WITH tx_counts AS (
    SELECT block_height AS height, COUNT(*) AS tx_count
    FROM ${chainId ? 'transaction_inclusions' : 'transactions'}
    WHERE block_height BETWEEN $1 AND $2 ${chainId ? 'AND chain_id = $3' : ''}
    GROUP BY block_height
  ), block_counts AS (
    SELECT b.height, b.num_txs FROM blocks b WHERE b.height BETWEEN $1 AND $2
  )
  SELECT COALESCE(b.height, t.height)::text AS height
  FROM block_counts b FULL OUTER JOIN tx_counts t USING (height)
  WHERE b.height IS NULL OR COALESCE(t.tx_count, 0) <> COALESCE(b.num_txs, 0)
  ORDER BY COALESCE(b.height, t.height)`;
}
