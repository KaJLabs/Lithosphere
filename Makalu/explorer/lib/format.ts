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
  const fracStr = frac.toString().padStart(DECIMALS, '0').slice(0, 4);
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
    // Cap at 4 decimal places for readability, then strip trailing zeros
    const fracStr = frac.toString().padStart(d, '0').slice(0, 4).replace(/0+$/, '');
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

/** Convert raw ulitho value to Strat display string (1 Strat = 1e14 ulitho = 0.0001 LITHO) */
export function formatStrat(amount: string | null | undefined): string {
  if (!amount || amount === '0') return '0 Strat';
  try {
    const raw = BigInt(amount);
    const stratDivisor = BigInt('100000000000000'); // 1e14
    const whole = raw / stratDivisor;
    const frac = raw % stratDivisor;
    const fracStr = frac.toString().padStart(14, '0').slice(0, 4).replace(/0+$/, '');
    const wholeFormatted = whole.toLocaleString('en-US');
    if (!fracStr) return `${wholeFormatted} Strat`;
    return `${wholeFormatted}.${fracStr} Strat`;
  } catch {
    return `${amount} Strat`;
  }
}

/**
 * Format an EVM gas price (raw wei = ulitho on Lithosphere) using the most
 * natural unit:
 *   ≥ 1 Strat (1e14 wei) → Strat (e.g. "1.5 Strat")
 *   ≥ 1 Gwei  (1e9  wei) → Gwei  (e.g. "12.34 Gwei")
 *   ≥ 1 wei              → ulitho/wei (e.g. "500 ulitho")
 *   0                    → "0"
 *
 * This avoids the "0 Strat" trap when the chain reports gas prices in the
 * usual EVM Gwei range — formatStrat truncates fractions below 0.0001 Strat
 * and rounds them to "0 Strat", which is technically correct but useless.
 */
export function formatGasPrice(wei: string | null | undefined): string {
  if (!wei || wei === '0') return '0';
  try {
    const raw = BigInt(wei);
    const STRAT = BigInt('100000000000000'); // 1e14 wei
    const GWEI  = BigInt('1000000000');      // 1e9  wei

    if (raw >= STRAT) {
      const whole = raw / STRAT;
      const frac = raw % STRAT;
      const fracStr = frac.toString().padStart(14, '0').slice(0, 4).replace(/0+$/, '');
      const wholeFormatted = whole.toLocaleString('en-US');
      return fracStr ? `${wholeFormatted}.${fracStr} Strat` : `${wholeFormatted} Strat`;
    }

    if (raw >= GWEI) {
      const whole = raw / GWEI;
      const frac = raw % GWEI;
      const fracStr = frac.toString().padStart(9, '0').slice(0, 2).replace(/0+$/, '');
      const wholeFormatted = whole.toLocaleString('en-US');
      return fracStr ? `${wholeFormatted}.${fracStr} Gwei` : `${wholeFormatted} Gwei`;
    }

    return `${raw.toString()} ulitho`;
  } catch {
    return `${wei}`;
  }
}

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

export function isValidatorAddress(addr: string): boolean {
  return addr.startsWith('lithovaloper1');
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
