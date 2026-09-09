import { ethers } from 'ethers';
import { config, resolveReleaseToken } from '../config.js';
import { pool } from '../db/pool.js';
import { createSourceEvidenceClient, verifySourceEvidence } from './sourceEvidence.js';

/**
 * Release executor — the automated counterpart to the validator (signing)
 * service. The signing loop advances a transfer locked → signing → signed and
 * then stops; nothing else submits the release. This service picks up rows that
 * are `signed` but not yet released and calls `releaseTokens` on the DESTINATION
 * bridge with the collected validator signatures, then records the release tx.
 *
 * MultXBridge.releaseTokens is permissionless — anyone holding >= the on-chain
 * `signaturesRequired` valid validator signatures (in strictly ascending signer
 * order) may submit it — so a single funded relayer EOA can drive releases for
 * every user. `processedNonces` on the contract makes this idempotent: a transfer
 * the user already claimed themselves (via the explorer) can't be double-paid.
 *
 * Enabled only when RELAYER_PRIVATE_KEY is set; otherwise releases fall back to
 * the manual/claim path and this loop stays dormant. The relayer EOA needs gas
 * on every destination chain it serves.
 */

const BRIDGE_ABI = [
  'function releaseTokens(address token, address user, uint256 amount, uint256 sourceChain, address sourceBridge, uint256 sourceNonce, bytes32 sourceTxHash, bytes[] signatures) external',
  'function getValidators() view returns (address[])',
  'function signaturesRequired() view returns (uint256)',
  'function paused() view returns (bool)',
  'function processedNonces(uint256, address, uint256) view returns (bool)',
];

let releaseIntervalId = null;
let running = false;                 // serialize ticks (one relayer EOA → no nonce races)
const inFlight = new Set();          // tx_hashes being processed in the current tick
const chainCtx = new Map();          // chainId → signer-bound connection; policy is read live

const short = (h) => (h ? `${h.substring(0, 10)}…` : h);

function destChainConfig(chainId) {
  return config.chainsToWatch.find((c) => Number(c.chainId) === Number(chainId)) || null;
}

// Lazily cache only the signer-bound bridge connection. Validator membership
// and threshold are re-read from chain for every release attempt.
async function getChainCtx(chainId) {
  const key = Number(chainId);
  if (chainCtx.has(key)) return chainCtx.get(key);

  const cc = destChainConfig(key);
  if (!cc || !cc.bridge) return null;

  const provider = new ethers.JsonRpcProvider(cc.rpc);
  const wallet = new ethers.Wallet(config.relayerPrivateKey, provider);
  const bridge = new ethers.Contract(cc.bridge, BRIDGE_ABI, wallet);
  const ctx = {
    bridge,
    bridgeAddress: cc.bridge,
    chainId: key,
    name: cc.name,
  };
  chainCtx.set(key, ctx);
  console.log(`[ReleaseService] dest ${cc.name} (${key}) bridge ${cc.bridge} connected; validator policy is read live per release`);
  return ctx;
}

export async function refreshValidatorPolicy(ctx) {
  const [required, validatorList] = await Promise.all([
    ctx.bridge.signaturesRequired(),
    ctx.bridge.getValidators(),
  ]);
  return {
    ...ctx,
    required: Number(required),
    validators: new Set(validatorList.map((address) => address.toLowerCase())),
  };
}

// Recover the signer of every stored signature, drop any that aren't current
// validators, dedupe by signer, and return the signatures sorted by signer
// ascending (the order releaseTokens requires).
async function orderedSignatures(tx, sourceBridge, token, ctx) {
  const { rows } = await pool.query(
    'SELECT signature FROM bridge_signatures WHERE tx_hash = $1',
    [tx.tx_hash]
  );
  const msgHash = ethers.solidityPackedKeccak256(
    ['bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'address'],
    [tx.tx_hash, sourceBridge, token, tx.from_address, tx.amount, tx.source_chain, tx.source_nonce,
      ctx.chainId, ctx.bridgeAddress]
  );
  const ethHash = ethers.hashMessage(ethers.getBytes(msgHash));

  const bySigner = new Map();
  for (const r of rows) {
    let signer;
    try { signer = ethers.recoverAddress(ethHash, r.signature); } catch { continue; }
    if (!ctx.validators.has(signer.toLowerCase())) continue;
    bySigner.set(signer.toLowerCase(), r.signature);
  }
  // lowercase hex of equal-length addresses sorts identically to numeric order
  return [...bySigner.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, sig]) => sig);
}

async function markCompleted(txHash, releaseTxHash) {
  await pool.query(
    `UPDATE bridge_transactions SET status = 'completed', release_tx_hash = $2, updated_at = NOW() WHERE tx_hash = $1`,
    [txHash, releaseTxHash]
  );
}

const sourceClients = new Map();

export async function submitSourceVerifiedRelease(tx, submit, source, client) {
  if (!source || !tx.block_hash || !tx.block_number ||
      resolveReleaseToken(tx.source_chain, tx.token_address, tx.target_chain)?.toLowerCase() !==
        tx.release_token?.toLowerCase()) {
    throw new Error('Missing or unmapped source release evidence; reconciliation required');
  }
  await verifySourceEvidence(source, {
    sourceChain: tx.source_chain, sourceBridge: tx.source_bridge,
    sourceBlock: tx.block_number, sourceBlockHash: tx.block_hash,
    sourceTxHash: tx.tx_hash, sourceToken: tx.token_address, user: tx.from_address,
    amount: tx.amount, targetChain: tx.target_chain, sourceNonce: tx.source_nonce,
  }, client);
  return submit();
}

async function releaseOne(tx) {
  if (!tx.release_token || !tx.source_chain || !tx.source_nonce) {
    console.warn(`[ReleaseService] incomplete release evidence — skipping ${short(tx.tx_hash)}`);
    return;
  }
  const connection = await getChainCtx(tx.target_chain);
  if (!connection) {
    console.warn(`[ReleaseService] no dest bridge for chain ${tx.target_chain} — skipping ${short(tx.tx_hash)}`);
    return;
  }
  const ctx = await refreshValidatorPolicy(connection);
  const token = tx.release_token;
  const amount = BigInt(tx.amount);
  const sourceBridge = tx.source_bridge;
  if (!sourceBridge) {
    console.warn(`[ReleaseService] no source bridge for chain ${tx.source_chain} — skipping ${short(tx.tx_hash)}`);
    return;
  }

  // Idempotency: already released on-chain (e.g. the user claimed via the
  // explorer). Reconcile the DB and move on — never resubmit.
  if (await ctx.bridge.processedNonces(tx.source_chain, sourceBridge, tx.source_nonce)) {
    await markCompleted(tx.tx_hash, null);
    console.log(`[ReleaseService] ${short(tx.tx_hash)} already processed on-chain — reconciled to completed`);
    return;
  }
  if (await ctx.bridge.paused()) {
    console.warn(`[ReleaseService] ${ctx.name} bridge paused — deferring ${short(tx.tx_hash)}`);
    return;
  }

  const sigs = await orderedSignatures(tx, sourceBridge, token, ctx);
  if (sigs.length < ctx.required) {
    console.log(`[ReleaseService] ${short(tx.tx_hash)}: ${sigs.length}/${ctx.required} valid sigs — waiting`);
    return;
  }

  try {
    const sourceSpec = config.chainsToWatch.find(c => Number(c.chainId) === Number(tx.source_chain));
    if (!sourceSpec) throw new Error('Source chain configuration is missing');
    const source = { chainId: sourceSpec.chainId, bridgeAddress: sourceSpec.bridge,
      rpcUrl: sourceSpec.rpc, confirmations: sourceSpec.confirmations };
    if (!sourceClients.has(source.chainId)) sourceClients.set(source.chainId, createSourceEvidenceClient(source));
    const resp = await submitSourceVerifiedRelease(tx, () => ctx.bridge.releaseTokens(
      token, tx.from_address, amount, tx.source_chain, sourceBridge, tx.source_nonce, tx.tx_hash,
      sigs.slice(0, ctx.required), { gasLimit: 400_000 }
    ), source, sourceClients.get(source.chainId));
    console.log(`[ReleaseService] releaseTokens sent for ${short(tx.tx_hash)} → ${resp.hash}`);
    const rcpt = await resp.wait();
    if (rcpt.status === 1) {
      await markCompleted(tx.tx_hash, resp.hash);
      console.log(`[ReleaseService] ✅ released ${short(tx.tx_hash)} on ${ctx.name} (block ${rcpt.blockNumber})`);
    } else {
      console.error(`[ReleaseService] release tx reverted for ${short(tx.tx_hash)} — leaving 'signed' to retry`);
    }
  } catch (err) {
    // Transient (gas, RPC, reorg): leave the row 'signed' so the next tick retries.
    console.error(`[ReleaseService] release failed for ${short(tx.tx_hash)}: ${String(err.reason || err.message).slice(0, 140)}`);
    await pool.query('UPDATE bridge_transactions SET failure_reason=$2, updated_at=NOW() WHERE tx_hash=$1',
      [tx.tx_hash, String(err.reason || err.message).slice(0, 500)]);
  }
}

async function processReleases() {
  if (running) return;               // a previous tick is still working
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT tx_hash, from_address, token_address, release_token, amount,
              target_chain, source_chain, source_bridge, source_nonce, block_number, block_hash
       FROM bridge_transactions
       WHERE status = 'signed' AND release_tx_hash IS NULL
       ORDER BY timestamp ASC`
    );
    for (const tx of rows) {
      if (inFlight.has(tx.tx_hash)) continue;
      inFlight.add(tx.tx_hash);
      try { await releaseOne(tx); } finally { inFlight.delete(tx.tx_hash); }
    }
  } catch (err) {
    console.error('[ReleaseService] processReleases error:', err.message);
  } finally {
    running = false;
  }
}

export async function startReleaseService() {
  if (!config.relayerPrivateKey) {
    console.warn('[ReleaseService] RELAYER_PRIVATE_KEY not set — release executor DISABLED (releases require manual/claim submission).');
    return;
  }
  const relayer = new ethers.Wallet(config.relayerPrivateKey);
  console.log(`[ReleaseService] Release executor enabled. Relayer EOA: ${relayer.address}`);
  releaseIntervalId = setInterval(processReleases, config.releaseIntervalMs);
  console.log(`[ReleaseService] Release loop started (interval: ${config.releaseIntervalMs}ms)`);
}

export function stopReleaseService() {
  if (releaseIntervalId) {
    clearInterval(releaseIntervalId);
    console.log('[ReleaseService] Release loop stopped');
  }
}
