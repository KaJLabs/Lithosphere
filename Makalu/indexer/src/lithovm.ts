// LithoVM (Lithic) native contracts on LITHO mainnet.
//
// Native contracts have no EVM code. Every call goes through the gateway
// 0x…f000, and every successful call that deploys contracts or emits events
// adds exactly one EVM log from the gateway whose data is UTF-8 JSON:
//   {"Deployments":[{codeHash,contract,creator,origin}], "Events":[{contract,name,values}]}
// `values` is an LVAL envelope ("LVAL" 0x01 | u16 count | count × (tag | payload)).
//
// This module turns those logs into the explorer's existing tables:
//   - Deployments → contracts (vm = 'lithovm', code_hash)
//   - Transfer(address from, address to, u256 amount) → token_transfers
// so the existing token, holder and transfer endpoints work unchanged.
//
// Protocol facts used here were checked against mainnet on 2026-11-24:
//   - gateway logs report blockNumber 0x0 (receipt top-level blockNumber is correct),
//   - eth_call through the gateway needs a non-zero `from`.
import { Interface, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { isLithicToken, type LithicAbi } from './lithic-interface.js';

export const LITHOVM_GATEWAY = '0x000000000000000000000000000000000000f000';
/** keccak256("LithoNativeLab(bytes)") */
export const LITHOVM_LOG_TOPIC = '0x093843f5e9eb40384e28a2de05071eb8158d09a803dec22fa5b5fb21a61e29a2';
/** First block with the LithoVM gateway on LITHO mainnet (upgrade lithovm-native-store-v1). */
export const LITHO_MAINNET_LITHOVM_START_BLOCK = 14_946_527;
/**
 * token_transfers is unique on (tx_hash, log_index). One gateway log can carry many
 * events, so Lithic rows use a synthetic index far above any real EVM log index:
 * BASE + (position of the log in the receipt) * 1000 + (position of the event).
 */
export const LITHOVM_LOG_INDEX_BASE = 1_000_000_000;
const MAX_EVENTS_PER_LOG = 1000;
// Largest log position whose last event index still fits in a Postgres INTEGER.
const MAX_LOG_POSITION = Math.floor((2_147_483_647 - LITHOVM_LOG_INDEX_BASE - (MAX_EVENTS_PER_LOG - 1)) / MAX_EVENTS_PER_LOG);
/** Any non-zero sender works for gateway reads. */
const READ_FROM = '0x0000000000000000000000000000000000000001';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

// ─── LVAL ───────────────────────────────────────────────────────────────────

export type LvalType = 'u64' | 'u256' | 'bool' | 'address' | 'bytes32' | 'string';
export type LvalValue =
  | { type: 'u64' | 'u256'; value: bigint }
  | { type: 'bool'; value: boolean }
  | { type: 'address' | 'bytes32' | 'string'; value: string };

const TAG_TYPES: Record<number, LvalType> = { 1: 'u64', 2: 'u256', 3: 'bool', 4: 'address', 5: 'bytes32', 6: 'string' };
const TYPE_TAGS: Record<LvalType, number> = { u64: 1, u256: 2, bool: 3, address: 4, bytes32: 5, string: 6 };
const MAGIC = [0x4c, 0x56, 0x41, 0x4c, 0x01]; // "LVAL" v1
const utf8 = new TextDecoder('utf-8', { fatal: true });

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) throw new Error('not 0x hex');
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));
}

/** Strict LVAL v1 decoder: rejects unknown tags, non-canonical words, bad UTF-8 and trailing bytes. */
export function decodeLval(hex: string): LvalValue[] {
  const b = hexToBytes(hex);
  if (b.length < 7 || b.length > 65_536 || MAGIC.some((v, i) => b[i] !== v)) throw new Error('LVAL: bad envelope');
  const count = (b[5] << 8) | b[6];
  if (count > 64) throw new Error('LVAL: too many values');
  let p = 7;
  const out: LvalValue[] = [];
  for (let i = 0; i < count; i++) {
    if (p >= b.length) throw new Error('LVAL: truncated');
    const type = TAG_TYPES[b[p++]];
    if (!type) throw new Error('LVAL: unknown tag');
    if (type === 'string') {
      if (p + 2 > b.length) throw new Error('LVAL: truncated');
      const len = (b[p] << 8) | b[p + 1];
      if (len > 4096 || p + 2 + len > b.length) throw new Error('LVAL: bad string length');
      out.push({ type, value: utf8.decode(b.subarray(p + 2, p + 2 + len)) });
      p += 2 + len;
      continue;
    }
    if (p + 32 > b.length) throw new Error('LVAL: truncated');
    const w = b.subarray(p, p + 32);
    p += 32;
    const zeroPrefix = (n: number) => w.subarray(0, n).every((x) => x === 0);
    const word = BigInt('0x' + Buffer.from(w).toString('hex'));
    if (type === 'u64') {
      if (!zeroPrefix(24)) throw new Error('LVAL: non-canonical u64');
      out.push({ type, value: word });
    } else if (type === 'u256') {
      out.push({ type, value: word });
    } else if (type === 'bool') {
      if (!zeroPrefix(31) || w[31] > 1) throw new Error('LVAL: non-canonical bool');
      out.push({ type, value: w[31] === 1 });
    } else if (type === 'address') {
      if (!zeroPrefix(12)) throw new Error('LVAL: non-canonical address');
      out.push({ type, value: '0x' + Buffer.from(w.subarray(12)).toString('hex') });
    } else {
      out.push({ type, value: '0x' + Buffer.from(w).toString('hex') });
    }
  }
  if (p !== b.length) throw new Error('LVAL: trailing bytes');
  return out;
}

/** LVAL encoder for gateway read arguments. */
export function encodeLval(values: Array<[LvalType, bigint | boolean | string]>): string {
  if (values.length > 64) throw new Error('LVAL: too many values');
  const parts: Buffer[] = [Buffer.from(MAGIC), Buffer.from([(values.length >> 8) & 0xff, values.length & 0xff])];
  const word = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
  for (const [type, value] of values) {
    parts.push(Buffer.from([TYPE_TAGS[type]]));
    if (type === 'string') {
      const s = Buffer.from(String(value), 'utf8');
      if (s.length > 4096) throw new Error('LVAL: string too long');
      parts.push(Buffer.from([(s.length >> 8) & 0xff, s.length & 0xff]), s);
    } else if (type === 'address' || type === 'bytes32') {
      const raw = String(value);
      if (type === 'address' ? !ADDRESS_RE.test(raw) : !HASH_RE.test(raw)) throw new Error(`LVAL: bad ${type}`);
      parts.push(Buffer.from(raw.slice(2).padStart(64, '0'), 'hex'));
    } else if (type === 'bool') {
      parts.push(word(value ? 1n : 0n));
    } else {
      const n = BigInt(value as bigint);
      if (n < 0n || n >= (type === 'u64' ? 2n ** 64n : 2n ** 256n)) throw new Error(`LVAL: ${type} out of range`);
      parts.push(word(n));
    }
  }
  return '0x' + Buffer.concat(parts).toString('hex');
}

// ─── Gateway logs ───────────────────────────────────────────────────────────

export interface GatewayLog {
  address: string;
  topics: string[];
  data: string;
}

export interface LithicDeployment {
  contract: string;
  creator: string;
  codeHash: string;
}

export interface LithicEvent {
  contract: string;
  name: string;
  values: string;
}

export interface GatewayRecord {
  deployments: LithicDeployment[];
  events: LithicEvent[];
}

export function isGatewayLog(log: GatewayLog): boolean {
  return typeof log?.address === 'string'
    && log.address.toLowerCase() === LITHOVM_GATEWAY
    && Array.isArray(log.topics)
    && log.topics.length === 1
    && typeof log.topics[0] === 'string'
    && log.topics[0].toLowerCase() === LITHOVM_LOG_TOPIC;
}

/** Parse one LithoNativeLab log. Returns null for other logs or malformed JSON; drops malformed entries. */
export function parseGatewayLog(log: GatewayLog): GatewayRecord | null {
  if (!isGatewayLog(log)) return null;
  let json: unknown;
  try {
    json = JSON.parse(utf8.decode(hexToBytes(log.data)));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const record = json as { Deployments?: unknown; Events?: unknown };
  const deployments: LithicDeployment[] = [];
  const events: LithicEvent[] = [];
  for (const d of Array.isArray(record.Deployments) ? record.Deployments : []) {
    const { contract, creator, codeHash } = (d ?? {}) as Record<string, unknown>;
    if (typeof contract === 'string' && ADDRESS_RE.test(contract)
      && typeof creator === 'string' && ADDRESS_RE.test(creator)
      && typeof codeHash === 'string' && HASH_RE.test(codeHash)) {
      deployments.push({ contract: contract.toLowerCase(), creator: creator.toLowerCase(), codeHash: codeHash.toLowerCase() });
    }
  }
  for (const e of Array.isArray(record.Events) ? record.Events : []) {
    const { contract, name, values } = (e ?? {}) as Record<string, unknown>;
    if (typeof contract === 'string' && ADDRESS_RE.test(contract)
      && typeof name === 'string' && name.length > 0 && name.length <= 128
      && typeof values === 'string' && HEX_RE.test(values)) {
      events.push({ contract: contract.toLowerCase(), name, values });
    }
  }
  return { deployments, events };
}

export interface LithicTransfer {
  from: string;
  to: string;
  value: string;
}

/** Transfer(address from, address to, u256 amount) → transfer; anything else → null. */
export function decodeLithicTransfer(event: LithicEvent): LithicTransfer | null {
  if (event.name !== 'Transfer') return null;
  let values: LvalValue[];
  try {
    values = decodeLval(event.values);
  } catch {
    return null;
  }
  if (values.length !== 3) return null;
  const [from, to, amount] = values as [LvalValue, LvalValue, LvalValue];
  if (from.type !== 'address' || to.type !== 'address' || amount.type !== 'u256') return null;
  return { from: from.value, to: to.value, value: amount.value.toString() };
}

/**
 * Block to start the one-shot gateway backfill from: LITHOVM_START_BLOCK when set,
 * the mainnet activation height on chain 9005, otherwise null (no LithoVM).
 */
export function resolveLithovmStartBlock(chainId: number, configured: string | undefined): number | null {
  if (configured !== undefined && configured.trim() !== '') {
    const n = Number(configured);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('LITHOVM_START_BLOCK must be a positive integer');
    return n;
  }
  return chainId === 9005 ? LITHO_MAINNET_LITHOVM_START_BLOCK : null;
}

export function lithicLogIndex(logPosition: number, eventPosition: number): number | null {
  if (!Number.isSafeInteger(logPosition) || !Number.isSafeInteger(eventPosition)) return null;
  if (logPosition < 0 || logPosition > MAX_LOG_POSITION || eventPosition < 0 || eventPosition >= MAX_EVENTS_PER_LOG) return null;
  return LITHOVM_LOG_INDEX_BASE + logPosition * MAX_EVENTS_PER_LOG + eventPosition;
}

// ─── Database writes ────────────────────────────────────────────────────────

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface LithicIndexResult {
  deployments: number;
  transfers: number;
}

/**
 * Store the Lithic deployments and Transfer events of one successful EVM transaction.
 * `logs` must be the receipt's logs in receipt order. Idempotent.
 */
export async function indexLithicReceiptLogs(
  client: Queryable,
  txHash: string,
  height: number,
  blockTime: string | Date,
  logs: GatewayLog[],
): Promise<LithicIndexResult> {
  const result: LithicIndexResult = { deployments: 0, transfers: 0 };
  const hash = txHash.toLowerCase();
  for (let position = 0; position < logs.length; position++) {
    const record = parseGatewayLog(logs[position]);
    if (!record) continue;

    for (const d of record.deployments) {
      // created_at is shown as the token's "Created" date, so it is the deploy block
      // time, not the time this row was indexed (which differs after a backfill).
      await client.query(
        `INSERT INTO contracts (address, creator, creation_tx, creation_block, vm, code_hash, created_at)
         VALUES ($1, $2, $3, $4, 'lithovm', $5, $6)
         ON CONFLICT (address) DO UPDATE SET
           vm = 'lithovm',
           code_hash = EXCLUDED.code_hash,
           creator = COALESCE(contracts.creator, EXCLUDED.creator),
           creation_tx = COALESCE(contracts.creation_tx, EXCLUDED.creation_tx),
           creation_block = COALESCE(contracts.creation_block, EXCLUDED.creation_block),
           created_at = LEAST(contracts.created_at, EXCLUDED.created_at),
           updated_at = NOW()`,
        [d.contract, d.creator, hash, height, d.codeHash, blockTime],
      );
      result.deployments++;
    }

    for (let i = 0; i < record.events.length; i++) {
      const transfer = decodeLithicTransfer(record.events[i]);
      if (!transfer) continue;
      const logIndex = lithicLogIndex(position, i);
      if (logIndex === null) continue;
      const contract = record.events[i].contract;
      await client.query(
        `INSERT INTO token_transfers
           (tx_hash, log_index, contract_address, from_address, to_address, value, token_id, block_height, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)
         ON CONFLICT ON CONSTRAINT token_transfers_tx_log_unique DO NOTHING`,
        [hash, logIndex, contract, transfer.from, transfer.to, transfer.value, height, blockTime],
      );
      await client.query(
        `INSERT INTO contracts (address, contract_type, vm)
         VALUES ($1, 'token', 'lithovm')
         ON CONFLICT (address) DO UPDATE SET
           contract_type = COALESCE(contracts.contract_type, 'token'),
           vm = 'lithovm'`,
        [contract],
      );
      if (BigInt(transfer.from) === 0n || BigInt(transfer.to) === 0n) {
        await client.query('UPDATE contracts SET metadata_checked_at = NULL WHERE address = $1', [contract]);
      }
      result.transfers++;
    }
  }
  return result;
}

// ─── Token metadata through the gateway ─────────────────────────────────────

export type LithicRpc = <T>(method: string, params: unknown[]) => Promise<T | null>;

const gateway = new Interface(['function call(address contract, bytes32 selector, bytes args) returns (bytes)']);

/** Full 32-byte native selector: keccak256("name(type,…)"). */
export function lithicSelector(signature: string): string {
  return keccak256(toUtf8Bytes(signature));
}

export function lithicCallData(contract: string, signature: string, args: Array<[LvalType, bigint | boolean | string]> = []): string {
  return gateway.encodeFunctionData('call', [getAddress(contract), lithicSelector(signature), encodeLval(args)]);
}

/** Read one value from a native contract; null when the call fails or the reply is malformed. */
export async function lithicRead(
  rpc: LithicRpc,
  contract: string,
  signature: string,
  args: Array<[LvalType, bigint | boolean | string]> = [],
): Promise<LvalValue | null> {
  try {
    const data = lithicCallData(contract, signature, args);
    const result = await rpc<string>('eth_call', [{ from: READ_FROM, to: LITHOVM_GATEWAY, data }, 'latest']);
    if (typeof result !== 'string' || result === '0x') return null;
    const [inner] = gateway.decodeFunctionResult('call', result);
    const values = decodeLval(String(inner));
    return values.length === 1 ? values[0] : null;
  } catch {
    return null;
  }
}

export interface LithicTokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number;
  totalSupply: string;
  contractType: 'token';
}

/**
 * A native contract is a fungible token when the token functions answer with the
 * token return types (decimals is u64 on LithoVM). Metadata never grants a verified badge.
 */
export async function discoverLithicToken(address: string, rpc: LithicRpc, abi?: LithicAbi[]): Promise<LithicTokenMetadata | null> {
  if (!ADDRESS_RE.test(address)) return null;
  if (abi && !isLithicToken(abi)) return null;
  const [name, symbol, decimals, supply, balance] = await Promise.all([
    lithicRead(rpc, address, 'name()'),
    lithicRead(rpc, address, 'symbol()'),
    lithicRead(rpc, address, 'decimals()'),
    lithicRead(rpc, address, 'total_supply()'),
    lithicRead(rpc, address, 'balance_of(address)', [['address', READ_FROM]]),
  ]);
  if (decimals?.type !== 'u64' || decimals.value > 255n) return null;
  if (supply?.type !== 'u256' || balance?.type !== 'u256') return null;
  const text = (value: LvalValue | null, max: number) => value?.type === 'string'
    ? value.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || null
    : null;
  return {
    name: text(name, 100),
    symbol: text(symbol, 20),
    decimals: Number(decimals.value),
    totalSupply: supply.value.toString(),
    contractType: 'token',
  };
}

// ─── One-shot backfill ──────────────────────────────────────────────────────

export interface BackfillDeps {
  rpc: LithicRpc;
  /** Pool-like: query() for reads, connect() for a per-transaction client. */
  db: Queryable & { connect(): Promise<Queryable & { release(): void }> };
  fromBlock: number;
  toBlock: number;
  window?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface BackfillResult {
  complete: boolean;
  transactions: number;
  deployments: number;
  transfers: number;
  failedWindows: number;
  failedTransactions: number;
}

interface ReceiptShape {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
  logs?: GatewayLog[];
}

/**
 * Find every gateway log in [fromBlock, toBlock] with eth_getLogs, then index each
 * transaction from its receipt (block number from the receipt, not the log).
 * `complete` is false when any window or transaction failed, so the caller can retry.
 */
export async function backfillLithicLogs(deps: BackfillDeps): Promise<BackfillResult> {
  const window = Math.min(10_000, Math.max(1, deps.window ?? 5_000));
  const result: BackfillResult = { complete: false, transactions: 0, deployments: 0, transfers: 0, failedWindows: 0, failedTransactions: 0 };
  const hashes = new Set<string>();
  for (let start = deps.fromBlock; start <= deps.toBlock; start += window) {
    const end = Math.min(start + window - 1, deps.toBlock);
    const logs = await deps.rpc<Array<{ transactionHash?: string } & GatewayLog>>('eth_getLogs', [{
      fromBlock: '0x' + start.toString(16),
      toBlock: '0x' + end.toString(16),
      address: LITHOVM_GATEWAY,
      topics: [LITHOVM_LOG_TOPIC],
    }]);
    if (!Array.isArray(logs)) {
      result.failedWindows++;
      deps.log?.('[lithovm] getLogs window failed', { start, end });
      continue;
    }
    for (const log of logs) {
      if (isGatewayLog(log) && typeof log.transactionHash === 'string' && HASH_RE.test(log.transactionHash)) {
        hashes.add(log.transactionHash.toLowerCase());
      }
    }
  }

  for (const hash of hashes) {
    try {
      const receipt = await deps.rpc<ReceiptShape>('eth_getTransactionReceipt', [hash]);
      if (!receipt || !Array.isArray(receipt.logs) || !receipt.blockNumber) throw new Error('receipt unavailable');
      if (receipt.status === '0x0') continue; // failed calls emit no gateway log; defensive
      const height = Number(BigInt(receipt.blockNumber));
      const time = await deps.db.query('SELECT block_time FROM blocks WHERE height = $1', [height]) as { rows?: Array<{ block_time: Date | string }> };
      const blockTime = time.rows?.[0]?.block_time;
      if (!blockTime) throw new Error(`block ${height} not indexed yet`);
      const client = await deps.db.connect();
      try {
        await client.query('BEGIN');
        const r = await indexLithicReceiptLogs(client, hash, height, blockTime, receipt.logs);
        await client.query('COMMIT');
        result.transactions++;
        result.deployments += r.deployments;
        result.transfers += r.transfers;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      result.failedTransactions++;
      deps.log?.('[lithovm] backfill transaction failed', { hash, err: err instanceof Error ? err.message : String(err) });
    }
  }
  result.complete = result.failedWindows === 0 && result.failedTransactions === 0;
  return result;
}
