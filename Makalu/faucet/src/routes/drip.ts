import type { FastifyInstance } from 'fastify';
import { isAddress } from 'viem';
import { drip } from '../services/wallet.js';
import { checkCooldown, setCooldown } from '../services/rateLimit.js';
import { config, getAssetConfig, isAllowedAmount } from '../config.js';

interface DripBody {
  address: string;
  amount?: string;
  assetId?: string;
  asset?: string;
}

export async function dripRoutes(app: FastifyInstance) {
  app.post<{ Body: DripBody }>('/drip', async (request, reply) => {
    const {
      address,
      amount: requestedAmount,
      assetId: requestedAssetId,
      asset: requestedAssetAlias,
    } = request.body ?? {};

    if (!address || !isAddress(address)) {
      return reply.status(400).send({
        error: 'Invalid address',
        message: 'Provide a valid Ethereum address in the request body: { "address": "0x..." }',
      });
    }

    const asset = getAssetConfig(
      typeof requestedAssetId === 'string'
        ? requestedAssetId
        : typeof requestedAssetAlias === 'string'
          ? requestedAssetAlias
          : undefined,
    );

    if (!asset) {
      return reply.status(400).send({
        error: 'Invalid asset',
        message: `Allowed assets: ${config.assets.map((item) => item.id).join(', ')}`,
      });
    }

    let dripAmount = asset.defaultAmount;
    if (requestedAmount) {
      const numeric = requestedAmount.replace(/[^0-9.]/g, '');
      if (isAllowedAmount(asset, numeric)) {
        dripAmount = numeric;
      } else {
        return reply.status(400).send({
          error: 'Invalid amount',
          message: `Allowed amounts for ${asset.symbol}: ${asset.allowedAmounts.map((value) => `${value} ${asset.symbol}`).join(', ')}`,
        });
      }
    }

    const { allowed, retryAfterSeconds } = await checkCooldown(address, asset.id);
    if (!allowed) {
      const hours = Math.ceil(retryAfterSeconds / 3600);
      return reply.status(429).send({
        error: 'Rate limited',
        message: `Address ${address} already received ${asset.symbol}. Try again in ~${hours}h.`,
        retryAfterSeconds,
      });
    }

    try {
      const result = await drip(address as `0x${string}`, asset, dripAmount);

      await setCooldown(address, asset.id);

      return reply.send({
        success: true,
        txHash: result.txHash,
        amount: `${result.amount} ${result.symbol}`,
        recipient: address,
        cooldownHours: config.cooldownHours,
        assetId: result.assetId,
        symbol: result.symbol,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[faucet] Drip failed for ${address}:`, message);
      return reply.status(500).send({
        error: 'Drip failed',
        message: `Could not send ${asset.symbol}. The faucet wallet may not be configured, funded, or authorized for that asset.`,
      });
    }
  });
}
