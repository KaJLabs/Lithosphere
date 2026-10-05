import { describe, expect, it } from 'vitest';

import { MAINNET_VALIDATOR_PROFILES, validatorBadge, validatorProfile } from '@/lib/validator-profiles';

describe('mainnet validator eligibility', () => {
  const entries = Object.entries(MAINNET_VALIDATOR_PROFILES);
  it('grants genesis only to the confirmed genesis operator, independent of staking status', () => {
    expect(entries.filter(([, profile]) => profile.genesis).map(([address]) => address)).toEqual([
      'lithovaloper1hg4klgm4s2tv2gmjxke27waz49knd2rq5tzfcw',
    ]);
    expect(validatorBadge({ address: entries[0][0], status: 'Unbonded', jailed: true }, true)).toBe('Genesis');
  });
  it.each(entries.slice(1))('requires confirmed bonding for %s', (address) => {
    for (const status of ['Unbonded', 'Unbonding', 'active', '']) {
      expect(validatorBadge({ address, status, jailed: false }, true)).toBe('Staged');
    }
    expect(validatorBadge({ address, status: 'Bonded' }, true)).toBe('Staged');
    expect(validatorBadge({ address, status: 'Bonded', jailed: true }, true)).toBe('Staged');
    for (const status of ['Bonded', 'BOND_STATUS_BONDED']) {
      expect(validatorBadge({ address, status, jailed: false }, true)).toBe('Post-genesis');
    }
  });
  it('does not associate other networks or unknown operators', () => {
    for (const [address] of entries) {
      expect(validatorProfile(address, false)).toBeUndefined();
      expect(validatorBadge({ address, status: 'Bonded', jailed: false }, false)).toBeNull();
    }
    expect(validatorProfile('toString', true)).toBeUndefined();
    expect(validatorBadge({ address: 'unrecognized', status: 'Bonded', jailed: false }, true)).toBeNull();
  });
});
