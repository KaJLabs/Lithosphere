import { describe, expect, it } from 'vitest';
import { isOfficialToken, officialTokenIcon, selectDegensIcon } from '../token-icons.js';

describe('token identity and icons', () => {
  const address = '0x29147bebb1c49c3a54aa464137611fe708886df3';
  it('resolves Ignite LAX artwork only for the registered chain and contract', () => {
    expect(officialTokenIcon(address.toUpperCase(), 9005)).toBe('/tokens/lax.png');
    expect(officialTokenIcon('0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', 700777)).toBe('/tokens/lax.png');
    expect(officialTokenIcon(address, 700777)).toBeNull();
    expect(officialTokenIcon(address, 1)).toBeNull();
    expect(officialTokenIcon('0x' + '12'.repeat(20), 9005)).toBeNull();
  });
  it('scopes the official LAX identity to mainnet', () => {
    expect(isOfficialToken(address, 9005)).toBe(true);
    expect(isOfficialToken(address, 700777)).toBe(false);
    expect(isOfficialToken('0x' + '12'.repeat(20), 9005)).toBe(false);
  });
  it('requires exact chain and address matches instead of trusting a symbol', () => {
    const icon = { chainId: 9005, tokenAddress: address, logoUrl: 'https://degens.lt/v1/uploads/logo.png' };
    expect(selectDegensIcon([icon], address, 9005)).toBe(icon.logoUrl);
    expect(selectDegensIcon([icon], address, 700777)).toBeNull();
    expect(selectDegensIcon([icon], '0x' + '11'.repeat(20), 9005)).toBeNull();
    expect(selectDegensIcon([{ ...icon, logoUrl: 'javascript:alert(1)' }], address, 9005)).toBeNull();
  });
});
