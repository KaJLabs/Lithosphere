import { ethers } from 'ethers';
import { config, resolveReleaseToken } from '../config.js';
import { pool } from '../db/pool.js';

const BRIDGE_ABI = [
  'event TokensLocked(bytes32 indexed txHash, address indexed token, address indexed user, uint256 amount, uint256 targetChain, uint256 nonce)'
];

const MAX_BACKOFF_MS = 30_000;
const MAX_BLOCKS_PER_POLL = 2_000;
const watchers = new Map();
const backoffMs = (attempts) => Math.min(2000 * 2 ** attempts, MAX_BACKOFF_MS);
const normalizedBridge = (spec) => spec.bridge.toLowerCase();

// Repeated checkpoint reads must reach RPC, even within ethers' default
// short-lived request cache window, to detect changes before SQL commit.
export function createEventProvider(spec) {
  return new ethers.JsonRpcProvider(spec.rpc, spec.chainId, {
    staticNetwork: true,
    cacheTimeout: -1,
  });
}

function makeWatcher(spec) {
  return {
    spec,
    provider: null,
    contract: null,
    lastBlock: null,
    lastBlockHash: null,
    consecutiveErrors: 0,
    pollTimer: null,
    retryTimer: null,
    reconnecting: false,
    polling: false,
  };
}

function clearTimers(w) {
  if (w.pollTimer) { clearInterval(w.pollTimer); w.pollTimer = null; }
  if (w.retryTimer) { clearTimeout(w.retryTimer); w.retryTimer = null; }
}

function scheduleReconnect(spec, w) {
  if (w.retryTimer) return;
  clearTimers(w);
  const delay = backoffMs(w.consecutiveErrors);
  console.warn(`[EventListener:${spec.name}] Reconnecting in ${delay / 1000}s (attempt ${w.consecutiveErrors})`);
  w.retryTimer = setTimeout(() => { w.retryTimer = null; startWatcher(spec); }, delay);
}

export async function loadDurableCursor(spec, provider, database = pool, currentBlock = null) {
  const result = await database.query(
    `SELECT last_processed_block, last_processed_hash
       FROM bridge_event_cursors
      WHERE chain_id = $1 AND bridge_address = $2`,
    [spec.chainId, normalizedBridge(spec)]
  );

  const configuredStart = Number.isSafeInteger(spec.startBlock) ? spec.startBlock : null;
  if (result.rows.length === 0) {
    if (configuredStart !== null) return configuredStart - 1;
    // Development compatibility only. Production manifests require an
    // explicit deployment start block and cannot silently skip history.
    return currentBlock ?? provider.getBlockNumber();
  }

  const persisted = Number(result.rows[0].last_processed_block);
  if (!Number.isSafeInteger(persisted) || persisted < 0) {
    throw new Error(`Invalid durable cursor for chain ${spec.chainId}`);
  }
  const minimum = configuredStart === null ? 0 : Math.max(0, configuredStart - 1);
  const overlap = Number.isSafeInteger(spec.reorgOverlap) ? spec.reorgOverlap : 0;
  const resumeFrom = Math.max(minimum, persisted - overlap);

  const persistedBlock = await provider.getBlock(persisted);
  const expectedHash = result.rows[0].last_processed_hash.toLowerCase();
  if (!persistedBlock?.hash || persistedBlock.hash.toLowerCase() !== expectedHash) {
    throw new Error(
      `Durable cursor hash mismatch for chain ${spec.chainId} at block ${persisted}; manual reconciliation required`
    );
  }
  return resumeFrom;
}

export async function processBlockRange(w, toBlock, database = pool) {
  const checkpoint = async () => {
    if (!w.lastBlockHash) return;
    const prior = await w.provider.getBlock(w.lastBlock);
    if (!prior?.hash || prior.hash.toLowerCase() !== w.lastBlockHash.toLowerCase()) {
      throw new Error('Polling checkpoint hash mismatch; manual reconciliation required');
    }
  };
  await checkpoint();
  const rangeTip = await w.provider.getBlock(toBlock);
  if (!rangeTip?.hash) throw new Error(`Missing block ${toBlock} while advancing cursor`);
  const filter = w.contract.filters.TokensLocked();
  const events = await w.contract.queryFilter(filter, w.lastBlock + 1, toBlock);
  const hashes = new Map([[toBlock, rangeTip.hash.toLowerCase()]]);
  for (const event of events) {
    if (event.removed || !Number.isSafeInteger(event.blockNumber) ||
        event.blockNumber <= w.lastBlock || event.blockNumber > toBlock || !event.blockHash) {
      throw new Error('Removed or invalid lock event in polled range');
    }
    if (!hashes.has(event.blockNumber)) {
      const block = await w.provider.getBlock(event.blockNumber);
      if (!block?.hash) throw new Error(`Missing event block ${event.blockNumber}`);
      hashes.set(event.blockNumber, block.hash.toLowerCase());
    }
    if (event.blockHash.toLowerCase() !== hashes.get(event.blockNumber)) {
      throw new Error('Lock event block hash mismatch; manual reconciliation required');
    }
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    for (const event of events) {
      const { txHash, token, user, amount, targetChain, nonce } = event.args;
      const releaseChainText = targetChain.toString();
      const releaseChainBigInt = BigInt(releaseChainText);
      const releaseChain = releaseChainBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(releaseChainBigInt)
        : null;
      const releaseToken = releaseChain === null
        ? null
        : resolveReleaseToken(w.spec.chainId, token, releaseChain);
      if (!releaseToken) {
        const reason = `unsupported route source=${w.spec.chainId}, token=${token}, target=${releaseChainText}`;
        await client.query(
          `INSERT INTO bridge_rejected_events
             (chain_id, bridge_address, block_number, block_hash, transaction_hash,
              log_index, lock_tx_hash, token_address, from_address, amount,
              target_chain, source_nonce, rejection_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (chain_id, bridge_address, block_number, log_index) DO UPDATE SET
             last_seen_at=NOW(), rejection_reason=EXCLUDED.rejection_reason`,
          [
            w.spec.chainId,
            normalizedBridge(w.spec),
            event.blockNumber,
            event.blockHash || null,
            event.transactionHash || event.log?.transactionHash || null,
            Number(event.index ?? event.logIndex ?? event.log?.index ?? 0),
            txHash,
            token,
            user,
            amount.toString(),
            releaseChainText,
            nonce.toString(),
            reason,
          ]
        );
        console.error(`[EventListener:${w.spec.name}] quarantined ${txHash}: ${reason}`);
        continue;
      }

      await client.query(
        `INSERT INTO bridge_transactions
           (tx_hash, from_address, token_address, amount, target_chain, source_bridge,
            source_chain, source_nonce, release_token, status, block_number, block_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'locked', $10, $11)
         ON CONFLICT (tx_hash) DO UPDATE SET
           block_number=EXCLUDED.block_number,
           block_hash=EXCLUDED.block_hash,
           source_bridge=EXCLUDED.source_bridge,
           source_chain=EXCLUDED.source_chain,
           release_token=EXCLUDED.release_token`,
        [
          txHash,
          user,
          token,
          amount.toString(),
          releaseChain,
          normalizedBridge(w.spec),
          w.spec.chainId,
          nonce.toString(),
          releaseToken,
          event.blockNumber,
          event.blockHash || null,
        ]
      );
    }

    await client.query(
      `INSERT INTO bridge_event_cursors
         (chain_id, bridge_address, last_processed_block, last_processed_hash, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (chain_id, bridge_address) DO UPDATE SET
         last_processed_block=EXCLUDED.last_processed_block,
         last_processed_hash=EXCLUDED.last_processed_hash,
         updated_at=NOW()`,
      [w.spec.chainId, normalizedBridge(w.spec), toBlock, rangeTip.hash]
    );
    await checkpoint();
    const finalTip = await w.provider.getBlock(toBlock);
    if (!finalTip?.hash || finalTip.hash.toLowerCase() !== rangeTip.hash.toLowerCase()) {
      throw new Error('Polled range reorganized before commit; retry required');
    }
    await client.query('COMMIT');
    w.lastBlock = toBlock;
    w.lastBlockHash = rangeTip.hash;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function pollChain(name) {
  const w = watchers.get(name);
  if (!w || !w.provider || !w.contract || w.lastBlock === null || w.polling) return;
  w.polling = true;
  try {
    const currentBlock = await w.provider.getBlockNumber();
    const confirmations = Number.isSafeInteger(w.spec.confirmations) ? w.spec.confirmations : 1;
    const confirmedTip = currentBlock - confirmations + 1;
    if (confirmedTip > w.lastBlock) {
      const toBlock = Math.min(confirmedTip, w.lastBlock + MAX_BLOCKS_PER_POLL);
      await processBlockRange(w, toBlock);
    }
    w.consecutiveErrors = 0;
  } catch (error) {
    console.error(`[EventListener:${name}] Poll error: ${error.message}`);
    w.consecutiveErrors++;
    scheduleReconnect(w.spec, w);
  } finally {
    w.polling = false;
  }
}

async function startWatcher(spec) {
  if (!spec.bridge) {
    console.warn(`[EventListener:${spec.name}] No bridge address configured - skipping.`);
    return;
  }

  const w = watchers.get(spec.name) ?? makeWatcher(spec);
  watchers.set(spec.name, w);
  if (w.reconnecting) return;
  w.reconnecting = true;
  clearTimers(w);

  try {
    w.provider = createEventProvider(spec);
    await w.provider.getNetwork();
    const currentBlock = await w.provider.getBlockNumber();
    if (w.lastBlock === null) {
      const initialBlock = await loadDurableCursor(spec, w.provider, pool, currentBlock);
      const checkpoint = await w.provider.getBlock(initialBlock);
      if (!checkpoint?.hash) throw new Error(`Missing initial polling checkpoint ${initialBlock}`);
      w.lastBlock = initialBlock;
      w.lastBlockHash = checkpoint.hash;
    }
    w.consecutiveErrors = 0;
    w.contract = new ethers.Contract(spec.bridge, BRIDGE_ABI, w.provider);
    console.log(
      `[EventListener:${spec.name}] Connected - chainId=${spec.chainId} bridge=${spec.bridge}; ` +
      `polling from block ${w.lastBlock} every ${spec.pollMs}ms`
    );
    w.pollTimer = setInterval(() => { pollChain(spec.name); }, spec.pollMs);
  } catch (error) {
    console.error(`[EventListener:${spec.name}] Connect error: ${error.message}`);
    w.consecutiveErrors++;
    scheduleReconnect(spec, w);
  } finally {
    w.reconnecting = false;
  }
}

export async function startEventListener() {
  const chains = config.chainsToWatch || [];
  if (chains.length === 0) {
    console.warn('[EventListener] No chainsToWatch configured - listener inactive.');
    return;
  }
  console.log(`[EventListener] Starting ${chains.length} parallel chain watcher(s)`);
  await Promise.all(chains.map((chain) => startWatcher(chain).catch((error) =>
    console.error(`[EventListener:${chain.name}] Initial start failed: ${error.message}`)
  )));
}

export function getProvider() {
  return watchers.get('kamet')?.provider ?? null;
}
