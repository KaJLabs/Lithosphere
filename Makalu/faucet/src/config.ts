import 'dotenv/config';

const ALLOWED_AMOUNTS = ['10', '25', '50'] as const;
export type FaucetAmount = (typeof ALLOWED_AMOUNTS)[number];

export function isAllowedAmount(value: string): value is FaucetAmount {
  return (ALLOWED_AMOUNTS as readonly string[]).includes(value);
}

const configuredDripAmount = process.env.FAUCET_DRIP_AMOUNT?.trim();
const dripAmount =
  configuredDripAmount && isAllowedAmount(configuredDripAmount)
    ? configuredDripAmount
    : ALLOWED_AMOUNTS[0];

export const config = {
  port: parseInt(process.env.FAUCET_PORT ?? '8081', 10),
  host: process.env.FAUCET_HOST ?? '0.0.0.0',

  // Chain
  rpcUrl: process.env.FAUCET_RPC_URL ?? 'http://localhost:8545',
  chainId: parseInt(process.env.FAUCET_CHAIN_ID ?? '700777', 10),

  // Faucet wallet
  privateKey: process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined,

  // Drip settings
  allowedAmounts: [...ALLOWED_AMOUNTS],
  dripAmount, // in LITHO (ether units)
  cooldownHours: parseInt(process.env.FAUCET_COOLDOWN_HOURS ?? '24', 10),

  // Redis (for rate limiting persistence)
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Rate limit (requests per window)
  rateLimitMax: parseInt(process.env.FAUCET_RATE_LIMIT_MAX ?? '5', 10),
  rateLimitWindowMinutes: parseInt(process.env.FAUCET_RATE_LIMIT_WINDOW ?? '60', 10),
} as const;
