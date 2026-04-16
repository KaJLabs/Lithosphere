import { describe, expect, it } from 'vitest';
import { resolveNativeBalance } from '../routes.js';

describe('resolveNativeBalance', () => {
  it('prefers live RPC balance over indexed account balance', async () => {
    const result = await resolveNativeBalance(
      '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387',
      '16228199354390909110949710',
      async () => '19998999999999999882400000',
    );

    expect(result).toEqual({
      balance: '19998999999999999882400000',
      balanceSource: 'rpc',
      rpcAttempted: true,
    });
  });

  it('treats a live zero balance as authoritative RPC state', async () => {
    const result = await resolveNativeBalance(
      '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387',
      '16228199354390909110949710',
      async () => '0',
    );

    expect(result).toEqual({
      balance: '0',
      balanceSource: 'rpc',
      rpcAttempted: true,
    });
  });

  it('falls back to indexed balance when live RPC is unavailable', async () => {
    const result = await resolveNativeBalance(
      '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387',
      '16228199354390909110949710',
      async () => null,
    );

    expect(result).toEqual({
      balance: '16228199354390909110949710',
      balanceSource: 'indexed',
      rpcAttempted: true,
    });
  });

  it('returns live RPC balance for synthetic tx-only addresses', async () => {
    const result = await resolveNativeBalance(
      '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387',
      null,
      async () => '19998999999999999882400000',
    );

    expect(result).toEqual({
      balance: '19998999999999999882400000',
      balanceSource: 'rpc',
      rpcAttempted: true,
    });
  });

  it('marks balance unavailable when tx-only addresses cannot reach live RPC', async () => {
    const result = await resolveNativeBalance(
      '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387',
      null,
      async () => null,
    );

    expect(result).toEqual({
      balance: '0',
      balanceSource: 'unavailable',
      rpcAttempted: true,
    });
  });
});
