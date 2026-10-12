import { DECIMALS, ULITHO_DECIMALS } from './constants';

export function truncateHash(hash: string, start = 10, end = 6): string {
  if (!hash) return '';
  if (hash.length <= start + end + 3) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

export function truncateAddress(addr: string, start = 12, end = 6): string {
  return truncateHash(addr, start, end);
}

export function formatNumber(n: string | number | null | undefined): string {
  if (n == null) return '0';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}

export function formatLitho(amount: string | null | undefined): string {
  if (!amount) return '0 LITHO';
  const raw = BigInt(amount);
  const divisor = BigInt('1' + '0'.repeat(DECIMALS));
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const wholeFormatted = whole.toLocaleString('en-US');
  if (frac === BigInt(0)) return `${wholeFormatted} LITHO`;
  return `${wholeFormatted}.${fracStr} LITHO`;
}

/** Convert raw ulitho value to LITHO display string (1 LITHO = 1e18 ulitho) */
export function formatValue(amount: string | null | undefined, denom?: string): string {
  if (!amount || amount === '0') return '0 LITHO';
  try {
    const raw = BigInt(amount);
    const d = ULITHO_DECIMALS;
    const divisor = BigInt('1' + '0'.repeat(d));
    const whole = raw / divisor;
    const frac = raw % divisor;
    // Keep every significant base unit; never convert a monetary value to Number.
    const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
    const wholeFormatted = whole.toLocaleString('en-US');
    if (!fracStr) return `${wholeFormatted} LITHO`;
    return `${wholeFormatted}.${fracStr} LITHO`;
  } catch {
    return `${amount} ${denom === 'ulitho' ? 'LITHO' : (denom ?? 'LITHO')}`;
  }
}

/** Format raw token supply (in smallest unit) to human-readable whole number */
export function formatSupply(raw: string | null | undefined, decimals = 18): string {
  if (!raw) return '0';
  try {
    const n = BigInt(raw);
    const divisor = BigInt('1' + '0'.repeat(decimals));
    const whole = n / divisor;
    return whole.toLocaleString('en-US');
  } catch {
    return formatNumber(raw);
  }
}

/**
 * Convert raw ulitho value to Strat display string.
 * 1 Strat = 100 ulitho. Verified against kamet.litho.ai's bundle, which
 * uses the same divisor (`CU = 100n`) — using the same definition keeps
 * Lithosphere's two explorers in agreement on what "1 Strat" means.
 *
 * On Lithosphere 1 wei = 1 ulitho, so an EVM gas price of 7 wei becomes
 * "0.07 Strat" rather than the pre-fix "0.00000000000007 Strat" trap that
 * came from the wrong 1e14 divisor.
 */
export function formatStrat(amount: string | null | undefined): string {
  if (!amount || amount === '0') return '0 Strat';
  try {
    const raw = BigInt(amount);
    const stratDivisor = BigInt(100);
    const whole = raw / stratDivisor;
    const frac = raw % stratDivisor;
    const fracStr = frac.toString().padStart(2, '0').replace(/0+$/, '');
    const wholeFormatted = whole.toLocaleString('en-US');
    if (!fracStr) return `${wholeFormatted} Strat`;
    return `${wholeFormatted}.${fracStr} Strat`;
  } catch {
    return `${amount} Strat`;
  }
}

/** Alias retained for call sites that mean specifically "EVM gas price in Strat". */
export const formatGasPrice = formatStrat;

export function formatGas(gas: string | null | undefined): string {
  if (!gas) return '-';
  return formatNumber(gas);
}

export function timeAgo(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Strip Ethereum branding from Cosmos SDK method names */
export function cleanMethod(method: string | undefined): string | undefined {
  if (!method) return method;
  return method.replace(/MsgEthereumTx/g, 'MsgTx');
}

/** Get display info for transaction type badge */
export function txTypeInfo(txType?: string): { label: string; color: string } {
  switch (txType) {
    case 'call':
      return { label: 'Call', color: 'border-blue-400/20 bg-blue-400/10 text-blue-300' };
    case 'create':
      return { label: 'Create', color: 'border-violet-400/20 bg-violet-400/10 text-violet-300' };
    case 'transfer':
    default:
      return { label: 'Transfer', color: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' };
  }
}

export function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export function isBech32Address(addr: string): boolean {
  return addr.startsWith('litho1');
}

// ── Address format conversion (Bech32 litho1 ⇄ EVM 0x) ──────────────────────
// Lithosphere accounts are a single 20-byte value with two encodings: the
// chain-branded Bech32 `litho1…` (BIP-173, includes a checksum) and the
// EVM-standard `0x…` hex. They are the SAME identity, never separate accounts.
// Self-contained codec (no dependency) — mirrors the API's evmToCosmos/cosmosToEvm.
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) >>> 0) ^ v;
    chk >>>= 0;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk = (chk ^ BECH32_GEN[i]) >>> 0;
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function bech32Checksum(hrp: string, data: number[]): number[] {
  const values = bech32HrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = (bech32Polymod(values) ^ 1) >>> 0;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) ret.push((mod >>> (5 * (5 - i))) & 31);
  return ret;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = ((acc << from) | value) >>> 0;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >>> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return ret;
}

/** Convert an EVM 0x address to its Lithosphere Bech32 equivalent (litho1…). */
export function evmToCosmos(evmAddr: string | null | undefined): string | undefined {
  if (!evmAddr || !isEvmAddress(evmAddr)) return undefined;
  const hex = evmAddr.slice(2);
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const words = convertBits(bytes, 8, 5, true);
  if (!words) return undefined;
  let out = 'litho1';
  for (const d of words.concat(bech32Checksum('litho', words))) out += BECH32_CHARSET[d];
  return out;
}

/** Convert a Lithosphere Bech32 address (litho1…) to its EVM 0x equivalent. */
export function cosmosToEvm(cosmosAddr: string | null | undefined): string | undefined {
  if (!cosmosAddr) return undefined;
  const lower = cosmosAddr.toLowerCase();
  if (!lower.startsWith('litho1')) return undefined;
  const pos = lower.lastIndexOf('1');
  const words: number[] = [];
  for (const c of lower.slice(pos + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return undefined;
    words.push(v);
  }
  const bytes = convertBits(words.slice(0, words.length - 6), 5, 8, false);
  if (!bytes || bytes.length !== 20) return undefined;
  return '0x' + bytes.map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Return the equivalent address in the *other* format, or undefined if the
 * input isn't a recognized address. 0x → litho1…, litho1… → 0x.
 */
export function altAddressFormat(addr: string | null | undefined): string | undefined {
  if (!addr) return undefined;
  if (isEvmAddress(addr)) return evmToCosmos(addr);
  if (isBech32Address(addr)) return cosmosToEvm(addr);
  return undefined;
}

export function isValidatorAddress(addr: string): boolean {
  return addr.startsWith('lithovaloper1');
}

/**
 * Preferred *display* form for an address: the Lithosphere bech32 form whenever
 * the value can be expressed that way, otherwise the input untouched.
 *
 * Both formats resolve on /address/… and the API, so this is safe to use for
 * href targets as well as label text.
 */
export function preferLitho(addr: string | null | undefined): string {
  if (!addr) return '';
  if (isBech32Address(addr)) return addr;
  return evmToCosmos(addr) ?? addr;
}

/**
 * Truncate an address for table/pill display. Bech32 addresses get a longer
 * head than 0x ones because the shared `litho1` prefix carries no information —
 * without it every litho address would render as an identical `litho1...`.
 */
export function truncateAddressSmart(addr: string | null | undefined, end = 6): string {
  if (!addr) return '';
  return truncateHash(addr, isBech32Address(addr) ? 11 : 8, end);
}

export function formatBlockTime(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  return `${seconds.toFixed(2)}s`;
}

export function validatorStatusLabel(status: number): string {
  switch (status) {
    case 1: return 'Unbonded';
    case 2: return 'Unbonding';
    case 3: return 'Bonded';
    default: return 'Unknown';
  }
}

export function proposalStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'passed': return 'badge-success';
    case 'rejected': return 'badge-error';
    case 'voting_period': return 'badge-info';
    case 'deposit_period': return 'badge-warning';
    default: return 'badge-neutral';
  }
}
