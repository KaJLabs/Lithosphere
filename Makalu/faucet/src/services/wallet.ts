import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Address,
  defineChain,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { config, type FaucetAsset } from '../config.js';

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const chain = defineChain({
  id: config.chainId,
  name: 'Lithosphere',
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const transport = http(config.rpcUrl);

const publicClient = createPublicClient({ chain, transport });

let account: PrivateKeyAccount | null = null;

function getAccount(): PrivateKeyAccount {
  if (account) return account;
  if (!config.privateKey) {
    throw new Error('FAUCET_PRIVATE_KEY not set');
  }
  account = privateKeyToAccount(config.privateKey);
  return account;
}

export async function drip(
  recipient: Address,
  asset: FaucetAsset,
  dripAmount?: string,
): Promise<{ txHash: string; amount: string; symbol: string; assetId: string }> {
  const acc = getAccount();
  const client = createWalletClient({ account: acc, chain, transport });
  const amountStr = dripAmount ?? asset.defaultAmount;

  if (asset.kind === 'native') {
    const txHash = await client.sendTransaction({
      account: acc,
      to: recipient,
      value: parseEther(amountStr),
      chain,
    });

    return { txHash, amount: amountStr, symbol: asset.symbol, assetId: asset.id };
  }

  const txHash = await client.writeContract({
    account: acc,
    chain,
    address: asset.contractAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, parseUnits(amountStr, asset.decimals)],
  });

  return { txHash, amount: amountStr, symbol: asset.symbol, assetId: asset.id };
}

async function getAssetBalance(asset: FaucetAsset): Promise<string> {
  if (!config.privateKey) return '0';

  const acc = getAccount();

  try {
    if (asset.kind === 'native') {
      const balance = await publicClient.getBalance({ address: acc.address });
      return formatEther(balance);
    }

    const balance = await publicClient.readContract({
      address: asset.contractAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [acc.address],
    }) as bigint;

    return formatUnits(balance, asset.decimals);
  } catch (error) {
    console.warn(
      `[faucet] Failed to fetch ${asset.symbol} balance:`,
      error instanceof Error ? error.message : String(error),
    );
    return '0';
  }
}

export async function getFaucetBalance(): Promise<string> {
  return getAssetBalance(config.nativeAsset);
}

export async function getFaucetAssetBalances(): Promise<Record<string, string>> {
  const balances = await Promise.all(
    config.assets.map(async (asset) => [asset.id, await getAssetBalance(asset)] as const),
  );

  return Object.fromEntries(balances);
}

export function getFaucetAddress(): string {
  if (!config.privateKey) return '0x0';
  return getAccount().address;
}
