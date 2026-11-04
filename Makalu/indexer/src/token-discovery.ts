import { Interface, decodeBytes32String } from 'ethers';

const abi = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function supportsInterface(bytes4) view returns (bool)',
]);
export type DiscoveryRpc = <T>(method: string, params: unknown[]) => Promise<T | null>;
export interface DiscoveredToken {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  contractType: 'token' | 'nft';
}

/** Inspect deployed code; metadata discovery never grants a verification badge. */
export async function discoverToken(address: string, rpc: DiscoveryRpc): Promise<DiscoveredToken | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  async function read(method: string, args: unknown[] = []): Promise<unknown> {
    try {
      const data = abi.encodeFunctionData(method, args);
      const result = await rpc<string>('eth_call', [{ to: address, data }, 'latest']);
      if (!result || result === '0x') return null;
      try { return abi.decodeFunctionResult(method, result)[0]; }
      catch {
        // Older token contracts return bytes32 metadata.
        if ((method === 'name' || method === 'symbol') && /^0x[0-9a-fA-F]{64}$/.test(result)) {
          return decodeBytes32String(result);
        }
        return null;
      }
    } catch { return null; }
  }
  const [name, symbol, decimals, supply, nft, multi] = await Promise.all([
    read('name'), read('symbol'), read('decimals'), read('totalSupply'),
    read('supportsInterface', ['0x80ac58cd']), read('supportsInterface', ['0xd9b67a26']),
  ]);
  const validDecimals = typeof decimals === 'bigint' && decimals >= 0n && decimals <= 255n;
  const validSupply = typeof supply === 'bigint' && supply >= 0n;
  // ERC-1155 alone is insufficient evidence of a fungible token.
  if (nft !== true && !(validDecimals && validSupply) && !(multi === true && validDecimals)) return null;
  const text = (value: unknown, max: number) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || null : null;
  return {
    name: text(name, 256), symbol: text(symbol, 64),
    decimals: nft === true ? 0 : validDecimals ? Number(decimals) : null,
    totalSupply: validSupply ? String(supply) : null,
    contractType: nft === true ? 'nft' : 'token',
  };
}
