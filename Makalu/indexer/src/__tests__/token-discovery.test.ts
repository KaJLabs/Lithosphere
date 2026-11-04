import { expect, it, vi } from 'vitest';
import { Interface } from 'ethers';
import { discoverToken, type DiscoveryRpc } from '../token-discovery.js';
const abi = new Interface([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function supportsInterface(bytes4) view returns (bool)',
]);
const address = '0x' + 'ab'.repeat(20);
function rpc(values: Record<string, unknown>): DiscoveryRpc {
  return vi.fn(async (_method, params) => {
    const call = abi.parseTransaction({ data: (params[0] as {data: string}).data })!;
    const value = values[call.name];
    return (value === undefined ? null : abi.encodeFunctionResult(call.name, [value])) as any;
  });
}
it('discovers an unseeded six-decimal token with zero supply before its first transfer', async () => {
  const result = await discoverToken(address, rpc({ name: 'New Coin', symbol: 'NEW', decimals: 6n, totalSupply: 0n }));
  expect(result).toEqual({ name: 'New Coin', symbol: 'NEW', decimals: 6, totalSupply: '0', contractType: 'token' });
});
it('lists a token even when optional name and symbol revert', async () => {
  expect(await discoverToken(address, rpc({ decimals: 18n, totalSupply: 1n }))).toMatchObject({ symbol: null, contractType: 'token' });
});
it('does not classify arbitrary contracts as coins', async () => {
  expect(await discoverToken(address, rpc({ name: 'Not a coin', symbol: 'NO' }))).toBeNull();
});
it('keeps ERC-721 collections out of fungible coins', async () => {
  expect(await discoverToken(address, rpc({ name: 'NFT', supportsInterface: true }))).toMatchObject({ contractType: 'nft', decimals: 0 });
});
