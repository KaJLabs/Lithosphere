/**
 * One-shot backfill: rewrite transactions.receiver / amount / denom for
 * historical rows that were indexed before the fee-collector fix.
 *
 * The previous `attr()` helper returned the first matching event attribute,
 * which in a Cosmos SDK tx is always the fee transfer (sender → fee_collector).
 * This script re-reads each affected block from CometBFT `/block_results`,
 * re-parses the events using the corrected logic, and updates the row only
 * when the values actually differ.
 *
 * Run from the indexer package:
 *     DATABASE_URL=... RPC_URL=https://rpc.litho.ai npx tsx src/backfill-fee-collector.ts
 *
 * Optional env:
 *   FROM_HEIGHT   - skip blocks below this height (default: 0)
 *   TO_HEIGHT     - skip blocks above this height (default: infinity)
 *   DRY_RUN=1     - log the diffs but don't write
 *   BATCH_SLEEP_MS- ms to sleep every 50 blocks (default: 50)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const RPC_URL = (process.env.RPC_URL || process.env.LITHO_RPC_URL || 'https://rpc.litho.ai').replace(/\/$/, '');
const FROM_HEIGHT = parseInt(process.env.FROM_HEIGHT || '0');
const TO_HEIGHT = parseInt(process.env.TO_HEIGHT || '0') || Number.POSITIVE_INFINITY;
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH_SLEEP_MS = parseInt(process.env.BATCH_SLEEP_MS || '50');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

interface TxEvent { type: string; attributes: Array<{ key: string; value: string }> }
interface TxResult { code: number; events: TxEvent[] }
interface RpcBlockResults { height: string; txs_results: TxResult[] | null }

function tryBase64(s: string): string | null {
  try {
    const buf = Buffer.from(s, 'base64');
    if (buf.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) return null;
    const d = buf.toString('utf-8');
    if (d.includes('\uFFFD')) return null;
    return d;
  } catch { return null; }
}

function attr(events: TxEvent[], eventType: string, key: string): string {
  for (const ev of events) {
    if (ev.type !== eventType) continue;
    for (const a of ev.attributes) {
      if (a.key === key) return a.value;
      const decodedKey = tryBase64(a.key);
      if (decodedKey === key) return tryBase64(a.value) ?? a.value;
    }
  }
  return '';
}

function attrTuples(events: TxEvent[], eventType: string, keys: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const ev of events) {
    if (ev.type !== eventType) continue;
    const row: Record<string, string> = {};
    for (const a of ev.attributes) {
      if (keys.includes(a.key)) { row[a.key] = a.value; continue; }
      const decodedKey = tryBase64(a.key);
      if (decodedKey && keys.includes(decodedKey)) row[decodedKey] = tryBase64(a.value) ?? a.value;
    }
    if (Object.keys(row).length) out.push(row);
  }
  return out;
}

/** Returns { receiver, amount, denom } parsed with the corrected logic. */
function deriveTransfer(evts: TxEvent[]): { receiver: string | null; amount: string; denom: string } {
  const feeStr = attr(evts, 'tx', 'fee') || '';
  const transfers = attrTuples(evts, 'transfer', ['sender', 'recipient', 'amount']);
  const nonFee = transfers.filter((t) => !feeStr || t.amount !== feeStr);
  const primary = nonFee[nonFee.length - 1] ?? transfers[transfers.length - 1];
  const recipient = primary?.recipient ?? attr(evts, 'coin_received', 'receiver');
  const rawAmt = primary?.amount ?? attr(evts, 'coin_received', 'amount') ?? '0';
  const m = rawAmt.match(/^(\d+)([a-zA-Z/]+)$/);
  return {
    receiver: recipient || null,
    amount: m?.[1] ?? '0',
    denom: m?.[2] ?? 'ulitho',
  };
}

async function fetchBlockResults(height: number): Promise<RpcBlockResults | null> {
  const url = `${RPC_URL}/block_results?height=${height}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) {
    console.warn(`[rpc] block_results height=${height} → HTTP ${resp.status}`);
    return null;
  }
  const json = await resp.json() as { result?: RpcBlockResults; error?: { message: string } };
  if (json.error) { console.warn(`[rpc] height=${height} error: ${json.error.message}`); return null; }
  return json.result ?? null;
}

async function main() {
  console.log(`[backfill] rpc=${RPC_URL} dryRun=${DRY_RUN} from=${FROM_HEIGHT} to=${TO_HEIGHT === Number.POSITIVE_INFINITY ? 'tip' : TO_HEIGHT}`);

  const distinctBlocks = await pool.query<{ block_height: string }>(
    `SELECT DISTINCT block_height FROM transactions
     WHERE block_height >= $1 AND block_height <= $2
     ORDER BY block_height ASC`,
    [FROM_HEIGHT, TO_HEIGHT === Number.POSITIVE_INFINITY ? 2_000_000_000 : TO_HEIGHT]
  );
  const total = distinctBlocks.rowCount ?? 0;
  console.log(`[backfill] ${total} distinct blocks to re-process`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const { block_height } of distinctBlocks.rows) {
    const height = Number(block_height);
    processed++;

    const rows = await pool.query<{ hash: string; tx_index: number; receiver: string | null; amount: string | null; denom: string | null }>(
      `SELECT hash, tx_index, receiver, amount, denom FROM transactions
       WHERE block_height = $1 ORDER BY tx_index ASC`,
      [height]
    );

    const results = await fetchBlockResults(height);
    if (!results?.txs_results) { skipped += rows.rowCount ?? 0; continue; }

    for (const row of rows.rows) {
      const txr = results.txs_results[row.tx_index];
      if (!txr) { skipped++; continue; }

      const derived = deriveTransfer(txr.events ?? []);

      const changed =
        (derived.receiver ?? null) !== (row.receiver ?? null) ||
        derived.amount !== (row.amount ?? '0') ||
        derived.denom !== (row.denom ?? 'ulitho');

      if (!changed) { unchanged++; continue; }

      if (DRY_RUN) {
        console.log(`[diff] ${row.hash.substring(0, 16)}… h=${height} idx=${row.tx_index}`);
        console.log(`       receiver: ${row.receiver} → ${derived.receiver}`);
        console.log(`       amount:   ${row.amount} ${row.denom} → ${derived.amount} ${derived.denom}`);
      } else {
        await pool.query(
          `UPDATE transactions SET receiver = $1, amount = $2, denom = $3 WHERE hash = $4`,
          [derived.receiver, derived.amount, derived.denom, row.hash]
        );
      }
      updated++;
    }

    if (processed % 50 === 0) {
      console.log(`[progress] ${processed}/${total} blocks · updated=${updated} unchanged=${unchanged} skipped=${skipped}`);
      if (BATCH_SLEEP_MS > 0) await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
    }
  }

  console.log(`[done] blocks=${processed} updated=${updated} unchanged=${unchanged} skipped=${skipped}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
