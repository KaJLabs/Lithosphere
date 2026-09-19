import fs from 'node:fs';
import { reconcileNativeDexBatch } from './services/nativeDexMonitor.js';
import { reconcileNativeRedemptionBatch } from './services/nativeRedemptionMonitor.js';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { ethers } from 'ethers';
import { reconcileNativePayoutBatch } from './services/nativePayoutMonitor.js';

// Separate, explicitly launched receipt worker. Standard PG* environment config.
// RPC config file: { "9005": "https://approved-rpc.example" }.
// No migrations, private keys or transaction submission in this process.
const providers = new Map();
const stop = new AbortController();
const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 20000 });
pool.on('error', () => { process.exitCode = 1; stop.abort(); });
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  if (!process.env.MULTX_PAYOUT_RPC_FILE) throw Error('RPC file required');
  const entries = Object.entries(JSON.parse(fs.readFileSync(process.env.MULTX_PAYOUT_RPC_FILE, 'utf8')));
  if (!entries.length) throw Error('RPC configuration empty');
  for (const [id, endpoint] of entries) {
    const chain = Number(id);
    if (!Number.isSafeInteger(chain) || chain <= 0 || String(chain) !== id) throw Error('invalid chain');
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('invalid RPC protocol');
    const request = new ethers.FetchRequest(url.href);
    request.timeout = 10000;
    providers.set(chain, new ethers.JsonRpcProvider(request));
  }
  let after = '', dexAfter = '', redemptionAfter = '';
  const withDex = process.argv.includes('--with-dex');
  do {
    if (withDex) {
      const dex = await reconcileNativeDexBatch(pool, providers, { after: dexAfter, signal: stop.signal });
      for (const result of dex.results) console.log(JSON.stringify({ leg: 'dex', ...result }));
      dexAfter = dex.next;
      const redemption = await reconcileNativeRedemptionBatch(pool, providers, {after:redemptionAfter, signal:stop.signal});
      for(const result of redemption.results) console.log(JSON.stringify({leg:'redemption',...result}));
      redemptionAfter = redemption.next;
    }
    const batch = await reconcileNativePayoutBatch(pool, providers, { after, signal: stop.signal });
    for (const result of batch.results) console.log(JSON.stringify(result));
    after = batch.next;
    if (!after && !dexAfter && !redemptionAfter && process.argv.includes('--once')) break;
    if (!after && !dexAfter && !redemptionAfter) await setTimeout(5000, undefined, { signal: stop.signal });
  } while (!stop.signal.aborted);
} catch {
  if (!stop.signal.aborted) {
    console.error('Native payout monitor failed; check database and RPC configuration.');
    process.exitCode = 1;
  }
} finally {
  for (const provider of providers.values()) provider.destroy();
  await pool.end();
}
