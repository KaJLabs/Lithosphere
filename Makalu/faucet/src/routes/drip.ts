import type { FastifyInstance } from 'fastify';
import { isAddress } from 'viem';
import { drip } from '../services/wallet.js';
import { checkCooldown, setCooldown } from '../services/rateLimit.js';
import { config } from '../config.js';

const ALLOWED_AMOUNTS = ['1', '2'];

interface DripBody {
  address: string;
  amount?: string;
}

export async function dripRoutes(app: FastifyInstance) {
  app.post<{ Body: DripBody }>('/drip', async (request, reply) => {
    const { address, amount: requestedAmount } = request.body ?? {};

    if (!address || !isAddress(address)) {
      return reply.status(400).send({
        error: 'Invalid address',
        message: 'Provide a valid Ethereum address in the request body: { "address": "0x..." }',
      });
    }

    // Parse and validate amount (default to config drip amount)
    let dripAmount = config.dripAmount;
    if (requestedAmount) {
      // Extract numeric part from strings like "1 LITHO" or "2"
      const numeric = requestedAmount.replace(/[^0-9.]/g, '');
      if (ALLOWED_AMOUNTS.includes(numeric)) {
        dripAmount = numeric;
      } else {
        return reply.status(400).send({
          error: 'Invalid amount',
          message: `Allowed amounts: ${ALLOWED_AMOUNTS.map(a => `${a} LITHO`).join(', ')}`,
        });
      }
    }

    // Check cooldown (does NOT set it — that happens after successful drip)
    const { allowed, retryAfterSeconds } = await checkCooldown(address);
    if (!allowed) {
      const hours = Math.ceil(retryAfterSeconds / 3600);
      return reply.status(429).send({
        error: 'Rate limited',
        message: `Address ${address} already received tokens. Try again in ~${hours}h.`,
        retryAfterSeconds,
      });
    }

    try {
      const result = await drip(address as `0x${string}`, dripAmount);

      // Only set cooldown AFTER successful drip
      await setCooldown(address);

      return reply.send({
        success: true,
        txHash: result.txHash,
        amount: `${result.amount} LITHO`,
        recipient: address,
        cooldownHours: config.cooldownHours,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[faucet] Drip failed for ${address}:`, message);
      return reply.status(500).send({
        error: 'Drip failed',
        message: 'Could not send tokens. The faucet wallet may not be configured or the chain may be down.',
      });
    }
  });
}
