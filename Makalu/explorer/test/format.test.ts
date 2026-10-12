import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanMethod,
  formatBlockTime,
  formatGas,
  formatLitho,
  formatNumber,
  formatStrat,
  formatSupply,
  formatTimestamp,
  formatValue,
  isBech32Address,
  isEvmAddress,
  isValidatorAddress,
  evmToCosmos,
  cosmosToEvm,
  altAddressFormat,
  preferLitho,
  truncateAddressSmart,
  proposalStatusColor,
  timeAgo,
  truncateAddress,
  truncateHash,
  txTypeInfo,
  validatorStatusLabel,
} from '../lib/format';

describe('address format conversion (litho1 ⇄ 0x)', () => {
  // Verified equivalent pair: same 20-byte account, two encodings.
  const EVM = '0x599a7e135f1790ae117b4eddc0422d24bc766161';
  const LITHO = 'litho1txd8uy6lz7g2uytmfmwuqs3dyj78vctpkg0ynr';

  it('converts EVM 0x to Lithosphere bech32', () => {
    expect(evmToCosmos(EVM)).toBe(LITHO);
  });

  it('converts Lithosphere bech32 to EVM 0x (lowercase)', () => {
    expect(cosmosToEvm(LITHO)).toBe(EVM);
  });

  it('round-trips both directions', () => {
    expect(cosmosToEvm(evmToCosmos(EVM)!)).toBe(EVM);
    expect(evmToCosmos(cosmosToEvm(LITHO)!)).toBe(LITHO);
  });

  it('is case-insensitive on the bech32 input', () => {
    expect(cosmosToEvm(LITHO.toUpperCase().replace('LITHO1', 'litho1'))).toBe(EVM);
  });

  it('preferLitho converts EVM input to bech32', () => {
    expect(preferLitho(EVM)).toBe(LITHO);
  });

  it('preferLitho leaves an already-bech32 address untouched', () => {
    expect(preferLitho(LITHO)).toBe(LITHO);
  });

  it('preferLitho falls back to the input when it is not convertible', () => {
    expect(preferLitho('not-an-address')).toBe('not-an-address');
    expect(preferLitho(null)).toBe('');
    expect(preferLitho(undefined)).toBe('');
  });

  it('truncateAddressSmart keeps a longer head for bech32 so addresses stay distinguishable', () => {
    const a = truncateAddressSmart(LITHO);
    // Must retain characters beyond the shared `litho1` prefix.
    expect(a.startsWith('litho1')).toBe(true);
    expect(a.slice(0, 11)).toBe(LITHO.slice(0, 11));
    expect(a.endsWith(LITHO.slice(-6))).toBe(true);
  });

  // Anchors the codec against a pair confirmed live by GET /api/address/… on
  // Makalu (the FGPT LEP-100 contract), not just internal round-tripping.
  it('matches the bech32 form the Makalu API returns for a known contract', () => {
    expect(preferLitho('0x151ef362ea96853702cc5e7728107e3961fbd22e'))
      .toBe('litho1z500xch2j6znwqkvtemjsyr789slh53wstcpq4');
  });

  it('truncateAddressSmart distinguishes two addresses sharing the litho1 prefix', () => {
    const other = evmToCosmos('0x151ef362ea96853702cc5e7728107e3961fbd22e')!;
    expect(truncateAddressSmart(other)).not.toBe(truncateAddressSmart(LITHO));
  });

  it('truncateAddressSmart handles empty input', () => {
    expect(truncateAddressSmart('')).toBe('');
    expect(truncateAddressSmart(null)).toBe('');
  });

  it('altAddressFormat returns the opposite encoding', () => {
    expect(altAddressFormat(EVM)).toBe(LITHO);
    expect(altAddressFormat(LITHO)).toBe(EVM);
  });

  it('returns undefined for invalid / empty input', () => {
    expect(evmToCosmos('0x123')).toBeUndefined();
    expect(evmToCosmos('not-an-address')).toBeUndefined();
    expect(evmToCosmos(null)).toBeUndefined();
    expect(cosmosToEvm('cosmos1abc')).toBeUndefined();
    expect(cosmosToEvm(undefined)).toBeUndefined();
    expect(altAddressFormat('garbage')).toBeUndefined();
  });
});

describe('truncateHash / truncateAddress', () => {
  it('truncates long hashes with default lengths', () => {
    const hash = '0xabcdefghijklmnopqrstuvwxyz1234567890abcdef';
    expect(truncateHash(hash)).toBe('0xabcdefgh...abcdef');
  });

  it('returns short hashes unchanged', () => {
    expect(truncateHash('0xabc')).toBe('0xabc');
  });

  it('handles empty strings', () => {
    expect(truncateHash('')).toBe('');
  });

  it('truncateAddress delegates to truncateHash', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    expect(truncateAddress(addr)).toBe('0x1234567890...345678');
  });
});

describe('formatNumber', () => {
  it('formats with US locale separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('handles string input', () => {
    expect(formatNumber('1000000')).toBe('1,000,000');
  });

  it('returns "0" for null/undefined/NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber('not-a-number')).toBe('0');
  });
});

describe('formatLitho / formatValue', () => {
  it('preserves all 18 fractional digits, including a single base unit', () => {
    for (const format of [formatLitho, formatValue]) {
      expect(format('1')).toBe('0.000000000000000001 LITHO');
      expect(format('1123456789012345678')).toBe('1.123456789012345678 LITHO');
    }
  });
  it('formats 1 LITHO (1e18 ulitho) as "1 LITHO"', () => {
    expect(formatLitho('1000000000000000000')).toBe('1 LITHO');
  });

  it('formats fractional LITHO without unnecessary trailing zeros', () => {
    // 1.5 LITHO
    expect(formatLitho('1500000000000000000')).toBe('1.5 LITHO');
  });

  it('formats zero / null', () => {
    expect(formatLitho('0')).toBe('0 LITHO');
    expect(formatLitho(null)).toBe('0 LITHO');
  });

  it('formatValue strips trailing zeros from fractional part', () => {
    expect(formatValue('1500000000000000000')).toBe('1.5 LITHO');
    expect(formatValue('1000000000000000000')).toBe('1 LITHO');
  });

  it('formatValue handles huge values without precision loss', () => {
    // 1 billion LITHO
    expect(formatValue('1000000000000000000000000000')).toBe('1,000,000,000 LITHO');
  });
});

describe('formatSupply', () => {
  it('strips decimals and formats whole token count', () => {
    expect(formatSupply('1000000000000000000000000')).toBe('1,000,000');
  });

  it('returns "0" for null', () => {
    expect(formatSupply(null)).toBe('0');
  });

  it('respects custom decimals', () => {
    // 100 tokens with 6 decimals
    expect(formatSupply('100000000', 6)).toBe('100');
  });
});

describe('formatStrat (1 Strat = 100 ulitho)', () => {
  it('formats 100 ulitho as 1 Strat', () => {
    expect(formatStrat('100')).toBe('1 Strat');
  });

  it('formats fractional Strat', () => {
    expect(formatStrat('7')).toBe('0.07 Strat');
  });

  it('handles zero / null', () => {
    expect(formatStrat('0')).toBe('0 Strat');
    expect(formatStrat(null)).toBe('0 Strat');
  });

  it('strips trailing zeros', () => {
    expect(formatStrat('150')).toBe('1.5 Strat');
  });
});

describe('formatGas / formatBlockTime', () => {
  it('formatGas applies number formatting', () => {
    expect(formatGas('21000')).toBe('21,000');
  });

  it('formatGas returns "-" for null', () => {
    expect(formatGas(null)).toBe('-');
  });

  it('formatBlockTime renders 2 decimal seconds', () => {
    expect(formatBlockTime(0.525)).toBe('0.53s');
    expect(formatBlockTime(3.0)).toBe('3.00s');
  });

  it('formatBlockTime returns "-" for null', () => {
    expect(formatBlockTime(null)).toBe('-');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for the present moment', () => {
    expect(timeAgo('2026-05-11T11:59:58Z')).toBe('just now');
  });

  it('returns seconds for sub-minute deltas', () => {
    expect(timeAgo('2026-05-11T11:59:30Z')).toBe('30s ago');
  });

  it('returns minutes for sub-hour deltas', () => {
    expect(timeAgo('2026-05-11T11:30:00Z')).toBe('30m ago');
  });

  it('returns hours for sub-day deltas', () => {
    expect(timeAgo('2026-05-11T06:00:00Z')).toBe('6h ago');
  });

  it('returns days for sub-month deltas', () => {
    expect(timeAgo('2026-05-08T12:00:00Z')).toBe('3d ago');
  });

  it('returns "-" for null/undefined input', () => {
    expect(timeAgo(null)).toBe('-');
    expect(timeAgo(undefined)).toBe('-');
  });
});

describe('formatTimestamp', () => {
  it('formats an ISO string into a human-readable date+time', () => {
    const out = formatTimestamp('2026-05-11T12:34:56Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/May/);
  });

  it('returns "-" for null', () => {
    expect(formatTimestamp(null)).toBe('-');
  });
});

describe('cleanMethod', () => {
  it('strips Ethereum branding from Cosmos SDK method names', () => {
    expect(cleanMethod('/lithosphere.MsgEthereumTxResponse')).toBe('/lithosphere.MsgTxResponse');
  });

  it('returns input unchanged when no match', () => {
    expect(cleanMethod('/cosmos.bank.MsgSend')).toBe('/cosmos.bank.MsgSend');
  });

  it('passes through nullish values', () => {
    expect(cleanMethod(undefined)).toBeUndefined();
  });
});

describe('txTypeInfo', () => {
  it('returns Call info for call', () => {
    const info = txTypeInfo('call');
    expect(info.label).toBe('Call');
    expect(info.color).toContain('blue');
  });

  it('returns Create info for create', () => {
    const info = txTypeInfo('create');
    expect(info.label).toBe('Create');
    expect(info.color).toContain('violet');
  });

  it('falls back to Transfer for unknown or missing type', () => {
    expect(txTypeInfo()).toMatchObject({ label: 'Transfer' });
    expect(txTypeInfo('weird')).toMatchObject({ label: 'Transfer' });
  });
});

describe('address validators', () => {
  it('isEvmAddress matches 0x + 40-char hex', () => {
    expect(isEvmAddress('0x22d279d24f0b7ca5d49c5a7a7f032da416f72387')).toBe(true);
    expect(isEvmAddress('0x123')).toBe(false);
    expect(isEvmAddress('litho1abc')).toBe(false);
  });

  it('isBech32Address matches the litho1 prefix exactly (NOT lithovaloper1)', () => {
    expect(isBech32Address('litho1ytf8n5j0pd72t4yutfa87qed5st0wgu8lvvmtr')).toBe(true);
    // 'lithovaloper1abc' starts with 'lithov...', not 'litho1', so it does NOT match
    expect(isBech32Address('lithovaloper1abc')).toBe(false);
    expect(isBech32Address('0xabc')).toBe(false);
  });

  it('isValidatorAddress matches the lithovaloper1 prefix', () => {
    expect(isValidatorAddress('lithovaloper1abc')).toBe(true);
    expect(isValidatorAddress('litho1abc')).toBe(false);
  });
});

describe('validatorStatusLabel', () => {
  it.each([
    [1, 'Unbonded'],
    [2, 'Unbonding'],
    [3, 'Bonded'],
    [99, 'Unknown'],
  ])('maps status %i → %s', (status, label) => {
    expect(validatorStatusLabel(status)).toBe(label);
  });
});

describe('proposalStatusColor', () => {
  it.each([
    ['passed', 'badge-success'],
    ['rejected', 'badge-error'],
    ['voting_period', 'badge-info'],
    ['deposit_period', 'badge-warning'],
    ['unknown', 'badge-neutral'],
    [null, 'badge-neutral'],
  ])('maps "%s" → "%s"', (status, expected) => {
    expect(proposalStatusColor(status as string | null)).toBe(expected);
  });
});
