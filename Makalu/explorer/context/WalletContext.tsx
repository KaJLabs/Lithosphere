import React, { createContext, useContext, useEffect, useState } from 'react';
import { createAppKit, useAppKit, useAppKitAccount, useDisconnect } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';

const PROJECT_ID = '4d5085c5fd29c034f63f9256013dcd09';

const makaluChain = defineChain({
  id: 700777,
  name: 'Lithosphere Makalu',
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.litho.ai'] },
  },
  blockExplorers: {
    default: { name: 'Makalu Explorer', url: 'https://makalu.litho.ai' },
  },
  caipNetworkId: 'eip155:700777',
  chainNamespace: 'eip155',
});

const metadata = {
  name: 'Lithosphere Makalu Testnet Explorer',
  description: 'Lithosphere Makalu Testnet Block Explorer',
  url: 'https://makalu.litho.ai',
  icons: ['https://makalu.litho.ai/makalu-testnet-favicon.png'],
};

const ethersAdapter = new EthersAdapter();

try {
  createAppKit({
    adapters: [ethersAdapter],
    networks: [makaluChain],
    projectId: PROJECT_ID,
    metadata,
    features: {
      email: true,
      socials: ['google', 'x', 'discord', 'farcaster', 'github'],
      emailShowWallets: true,
    },
    featuredWalletIds: [
      'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
      'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e18e4a0eb6f0f94bd4', // Coinbase
    ],
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#34d399',
    },
  });
} catch (error) {
  console.log('AppKit init:', error instanceof Error ? error.message : 'already initialized');
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
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAppKitAccount();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  const value: WalletContextType = {
    address: address || null,
    isConnected: isConnected || false,
    chainId: chainId ? Number(chainId) : null,
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
