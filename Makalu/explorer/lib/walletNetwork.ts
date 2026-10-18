import { NETWORK, WALLET_CHAIN } from '@/lib/network';

export type WalletRequestProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function walletErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as {
    code?: unknown;
    error?: unknown;
    data?: { originalError?: unknown };
  };
  const direct = Number(candidate.code);
  if (Number.isFinite(direct)) return direct;

  return walletErrorCode(candidate.error) ?? walletErrorCode(candidate.data?.originalError);
}

export async function ensureExplorerNetwork(provider: WalletRequestProvider): Promise<void> {
  if (!NETWORK.walletReady) {
    throw new Error(`${NETWORK.label} RPC is not configured.`);
  }

  const activeChainId = await provider.request({ method: 'eth_chainId' });
  if (Number(activeChainId) === NETWORK.evmChainId) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: NETWORK.chainIdHex }],
    });
  } catch (error) {
    if (walletErrorCode(error) !== 4902) throw error;

    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [WALLET_CHAIN],
      });
    } catch (addError) {
      const message = typeof addError === 'object' && addError !== null && 'message' in addError
        ? String(addError.message) : '';
      if (walletErrorCode(addError) === 4001 && /unsupported network/i.test(message)) {
        throw new Error(`Add ${NETWORK.name} as a custom network in your wallet Settings using RPC ${NETWORK.rpcUrl} and chain ID ${NETWORK.evmChainId}, then try again.`);
      }
      throw addError;
    }
    // EIP-3085 adds a network without requiring the wallet to select it.
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: NETWORK.chainIdHex }],
    });
  }
}
