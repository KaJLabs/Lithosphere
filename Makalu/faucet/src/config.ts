import 'dotenv/config';
import { isAddress, type Address } from 'viem';

const DEFAULT_NATIVE_AMOUNTS = ['1', '2', '5'] as const;
const DEFAULT_TOKEN_AMOUNTS = ['10', '25', '50'] as const;

export type FaucetAmount = string;

export interface FaucetAssetBase {
  id: string;
  name: string;
  symbol: string;
  kind: 'native' | 'erc20';
  standard: 'native' | 'LEP-100';
  decimals: number;
  allowedAmounts: string[];
  defaultAmount: string;
}

export interface NativeFaucetAsset extends FaucetAssetBase {
  kind: 'native';
  standard: 'native';
}

export interface TokenFaucetAsset extends FaucetAssetBase {
  kind: 'erc20';
  standard: 'LEP-100';
  contractAddress: Address;
}

export type FaucetAsset = NativeFaucetAsset | TokenFaucetAsset;

type FaucetTokenAssetInput = {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  contractAddress?: unknown;
  decimals?: unknown;
  allowedAmounts?: unknown;
  defaultAmount?: unknown;
};

function normalizeAssetId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function parseAmountValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value.toString();
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function sanitizeAmountList(raw: unknown, fallback: readonly string[]): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];

  const seen = new Set<string>();
  const values = source
    .map((value) => parseAmountValue(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });

  return values.length > 0 ? values : [...fallback];
}

function resolveDefaultAmount(value: unknown, allowedAmounts: string[]): string {
  const parsed = parseAmountValue(value);
  return parsed && allowedAmounts.includes(parsed) ? parsed : allowedAmounts[0];
}

function parseTokenAssets(raw: string | undefined): TokenFaucetAsset[] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as FaucetTokenAssetInput[];
    if (!Array.isArray(parsed)) {
      throw new Error('FAUCET_TOKEN_ASSETS must be a JSON array');
    }

    const assets: TokenFaucetAsset[] = [];
    const seenIds = new Set<string>();

    for (const item of parsed) {
      const symbol = typeof item.symbol === 'string' && item.symbol.trim()
        ? item.symbol.trim().toUpperCase()
        : null;
      const fallbackId = symbol ? normalizeAssetId(symbol) : '';
      const id = normalizeAssetId(typeof item.id === 'string' && item.id.trim() ? item.id : fallbackId);
      const contractAddress = typeof item.contractAddress === 'string' ? item.contractAddress.trim() : '';

      if (!id || seenIds.has(id) || !symbol || !isAddress(contractAddress)) {
        console.warn('[faucet] Skipping invalid token asset config:', item);
        continue;
      }

      const parsedDecimals = Number(item.decimals);
      const decimals = Number.isInteger(parsedDecimals) && parsedDecimals >= 0
        ? parsedDecimals
        : 18;
      const allowedAmounts = sanitizeAmountList(item.allowedAmounts, DEFAULT_TOKEN_AMOUNTS);
      const defaultAmount = resolveDefaultAmount(item.defaultAmount, allowedAmounts);
      const name = typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : symbol;

      assets.push({
        id,
        name,
        symbol,
        kind: 'erc20',
        standard: 'LEP-100',
        decimals,
        allowedAmounts,
        defaultAmount,
        contractAddress: contractAddress as Address,
      });
      seenIds.add(id);
    }

    return assets;
  } catch (error) {
    console.warn(
      '[faucet] Failed to parse FAUCET_TOKEN_ASSETS:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

const nativeAllowedAmounts = sanitizeAmountList(
  process.env.FAUCET_NATIVE_ALLOWED_AMOUNTS,
  DEFAULT_NATIVE_AMOUNTS,
);
const configuredNativeDefaultAmount =
  process.env.FAUCET_NATIVE_DEFAULT_AMOUNT?.trim() ??
  process.env.FAUCET_DRIP_AMOUNT?.trim();
const dripAmount = resolveDefaultAmount(configuredNativeDefaultAmount, nativeAllowedAmounts);

const nativeAsset: NativeFaucetAsset = {
  id: 'litho',
  name: 'Lithosphere',
  symbol: 'LITHO',
  kind: 'native',
  standard: 'native',
  decimals: 18,
  allowedAmounts: nativeAllowedAmounts,
  defaultAmount: dripAmount,
};

const tokenAssets = parseTokenAssets(process.env.FAUCET_TOKEN_ASSETS);
const assets: FaucetAsset[] = [nativeAsset, ...tokenAssets];
const assetsById = new Map<string, FaucetAsset>();

for (const asset of assets) {
  assetsById.set(asset.id, asset);
  assetsById.set(asset.symbol.toLowerCase(), asset);
}

export function getAssetConfig(assetId?: string): FaucetAsset | undefined {
  if (!assetId) {
    return nativeAsset;
  }
  return assetsById.get(assetId.trim().toLowerCase());
}

export function isAllowedAmount(asset: FaucetAsset, value: string): boolean {
  return asset.allowedAmounts.includes(value);
}

export const config = {
  port: parseInt(process.env.FAUCET_PORT ?? '8081', 10),
  host: process.env.FAUCET_HOST ?? '0.0.0.0',

  // Chain
  rpcUrl: process.env.FAUCET_RPC_URL ?? 'http://localhost:8545',
  chainId: parseInt(process.env.FAUCET_CHAIN_ID ?? '700777', 10),

  // Faucet wallet
  privateKey: process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined,

  // Faucet assets
  assets,
  defaultAssetId: nativeAsset.id,
  nativeAsset,
  allowedAmounts: nativeAsset.allowedAmounts,
  dripAmount: nativeAsset.defaultAmount,

  // Drip settings
  cooldownHours: parseInt(process.env.FAUCET_COOLDOWN_HOURS ?? '24', 10),

  // Redis (for rate limiting persistence)
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Rate limit (requests per window)
  rateLimitMax: parseInt(process.env.FAUCET_RATE_LIMIT_MAX ?? '5', 10),
  rateLimitWindowMinutes: parseInt(process.env.FAUCET_RATE_LIMIT_WINDOW ?? '60', 10),
} as const;
