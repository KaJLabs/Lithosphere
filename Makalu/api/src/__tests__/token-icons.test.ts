import { describe, expect, it } from 'vitest';
import { isOfficialToken, selectDegensIcon } from '../token-icons.js';

describe('token identity and icons', () => {
  const address = '0x29147bebb1c49c3a54aa464137611fe708886df3';
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
