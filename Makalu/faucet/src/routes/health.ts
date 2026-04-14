import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getFaucetAssetBalances, getFaucetBalance, getFaucetAddress } from '../services/wallet.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    try {
      const [balance, balances] = await Promise.all([
        getFaucetBalance(),
        getFaucetAssetBalances(),
      ]);
      const address = getFaucetAddress();

      return reply.send({
        status: 'ok',
        service: 'lithosphere-faucet',
        faucetAddress: address,
        balance: `${balance} ${config.nativeAsset.symbol}`,
        allowedAmounts: config.allowedAmounts,
        defaultAmount: config.dripAmount,
        defaultAssetId: config.defaultAssetId,
        assets: config.assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          symbol: asset.symbol,
          kind: asset.kind,
          standard: asset.standard,
          decimals: asset.decimals,
          allowedAmounts: asset.allowedAmounts,
          defaultAmount: asset.defaultAmount,
          contractAddress: asset.kind === 'erc20' ? asset.contractAddress : null,
          balance: balances[asset.id] ?? '0',
        })),
        cooldownHours: config.cooldownHours,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return reply.status(503).send({ status: 'error', service: 'lithosphere-faucet' });
    }
  });
}
