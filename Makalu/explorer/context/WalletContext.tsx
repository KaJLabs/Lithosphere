import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  createWeb3Modal,
  defaultConfig,
  useWeb3Modal,
  useWeb3ModalAccount,
  useWeb3ModalProvider,
  useDisconnect,
} from '@web3modal/ethers/react';

const PROJECT_ID = '4d5085c5fd29c034f63f9256013dcd09';

const MAKALU_CHAIN = {
  chainId: 700777,
  name: 'Lithosphere Makalu Testnet',
  currency: 'LITHO',
  explorerUrl: 'https://makalu.litho.ai',
  rpcUrl: 'https://rpc.litho.ai',
};

const MAKALU_CHAIN_HEX = '0xab169';

const MAKALU_CHAIN_FOR_WALLET = {
  chainId: MAKALU_CHAIN_HEX,
  chainName: MAKALU_CHAIN.name,
  rpcUrls: [MAKALU_CHAIN.rpcUrl],
  nativeCurrency: {
    name: 'LITHO',
    symbol: 'LITHO',
    decimals: 18,
  },
  blockExplorerUrls: [MAKALU_CHAIN.explorerUrl],
};

type EthereumRequestProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const metadata = {
  name: 'Lithosphere Makalu Testnet Explorer',
  description: 'Lithosphere Makalu Testnet Block Explorer',
  url: 'https://makalu.litho.ai',
  icons: ['https://makalu.litho.ai/favicon.ico'],
};

const ethersConfig = defaultConfig({
  metadata,
  defaultChainId: MAKALU_CHAIN.chainId,
  rpcUrl: MAKALU_CHAIN.rpcUrl,
  chains: [MAKALU_CHAIN],
  enableInjected: true,     // MetaMask, Brave, etc.
  enableCoinbase: true,     // Coinbase Wallet
  enableEIP6963: true,      // Auto-detect all installed wallets
});

// Initialize Web3Modal once (try/catch handles HMR re-initialization)
try {
  createWeb3Modal({
    ethersConfig,
    chains: [MAKALU_CHAIN],
    projectId: PROJECT_ID,
    enableAnalytics: true,
    // Featured wallets shown first in the modal (like portal.litho.ai)
    featuredWalletIds: [
      'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
      'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e18e4a0eb6f0f94bd4', // Coinbase
    ],
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#34d399',  // Match our emerald accent
    },
  });
} catch (error) {
  console.log('Web3Modal init:', error instanceof Error ? error.message : 'already initialized');
}

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  open: (options?: { view: 'Connect' | 'Account' | 'Networks' }) => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { open } = useWeb3Modal();
  const { address, chainId, isConnected } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  const lastPromptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // After a wallet connects, always prompt to switch/add Makalu if user is on another network.
  useEffect(() => {
    if (!isConnected || !address) {
      lastPromptKeyRef.current = null;
      return;
    }

    if (chainId === MAKALU_CHAIN.chainId) {
      return;
    }

    const promptKey = `${address.toLowerCase()}-${String(chainId ?? 'unknown')}`;
    if (lastPromptKeyRef.current === promptKey) {
      return;
    }

    lastPromptKeyRef.current = promptKey;

    const trySwitchOrAddMakalu = async () => {
      const injectedProvider =
        typeof window !== 'undefined'
          ? (window as Window & { ethereum?: EthereumRequestProvider }).ethereum
          : undefined;

      const provider =
        (walletProvider as EthereumRequestProvider | undefined) ?? injectedProvider;

      if (!provider?.request) {
        return;
      }

      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: MAKALU_CHAIN_HEX }],
        });
      } catch (switchError) {
        const code =
          typeof switchError === 'object' && switchError && 'code' in switchError
            ? Number((switchError as { code?: number | string }).code)
            : undefined;

        const message =
          switchError instanceof Error ? switchError.message : String(switchError ?? '');

        const chainMissing =
          code === 4902 || /4902|unrecognized chain|not been added/i.test(message);

        if (chainMissing) {
          try {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [MAKALU_CHAIN_FOR_WALLET],
            });
          } catch (addError) {
            const addCode =
              typeof addError === 'object' && addError && 'code' in addError
                ? Number((addError as { code?: number | string }).code)
                : undefined;

            if (addCode !== 4001) {
              console.error('Failed to add Makalu network:', addError);
            }
          }
          return;
        }

        if (code !== 4001) {
          console.error('Failed to switch to Makalu network:', switchError);
        }
      }
    };

    void trySwitchOrAddMakalu();
  }, [address, chainId, isConnected, walletProvider]);

  if (!mounted) {
    return <>{children}</>;
  }

  const value: WalletContextType = {
    address: address || null,
    isConnected: isConnected || false,
    chainId: chainId || null,
    open,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}
