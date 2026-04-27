import React, { createContext, useContext, useEffect, useState } from 'react';
import { createWeb3Modal, defaultConfig, useWeb3Modal, useWeb3ModalAccount, useDisconnect } from '@web3modal/ethers/react';

const PROJECT_ID = '4d5085c5fd29c034f63f9256013dcd09';

const chains = [
  {
    chainId: 700777,
    name: 'Lithosphere Makalu',
    currency: 'LITHO',
    explorerUrl: 'https://makalu.litho.ai',
    rpcUrl: 'https://rpc.litho.ai',
  },
];

const metadata = {
  name: 'Lithosphere Makalu Testnet Explorer',
  description: 'Lithosphere Makalu Testnet Block Explorer',
  url: 'https://makalu.litho.ai',
  icons: ['https://makalu.litho.ai/makalu-testnet-favicon.png'],
};

const ethersConfig = defaultConfig({
  metadata,
  enableEIP6963: true,
  enableInjected: true,
  enableCoinbase: true,
  rpcUrl: 'https://rpc.litho.ai',
  defaultChainId: 700777,
  auth: { email: false, socials: [] },
});

// createWeb3Modal must only run on the client — it accesses localStorage/IndexedDB
// which don't exist on the server and cause silent failures that break mobile wallets
if (typeof window !== 'undefined') {
  try {
    createWeb3Modal({
      ethersConfig,
      chains,
      projectId: PROJECT_ID,
      featuredWalletIds: [
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
        '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
        'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e18e4a0eb6f0f94bd4',
      ],
      themeMode: 'dark',
      themeVariables: {
        '--w3m-accent': '#34d399',
      },
    });
  } catch (error) {
    console.log('Web3Modal init:', error instanceof Error ? error.message : 'already initialized');
  }
}

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  open: (options?: { view: 'Connect' | 'Account' | 'Networks' }) => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Hooks from @web3modal must never be called on the server — createWeb3Modal
// is client-only, so calling hooks before it throws. This inner component
// only renders after mount (useEffect never runs on the server), ensuring
// the hooks are called exclusively in the browser.
function WalletProviderClient({ children }: { children: React.ReactNode }) {
  const { open } = useWeb3Modal();
  const { address, chainId, isConnected } = useWeb3ModalAccount();
  const { disconnect } = useDisconnect();

  const value: WalletContextType = {
    address: address || null,
    isConnected: isConnected || false,
    chainId: chainId ? Number(chainId) : null,
    open,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return <WalletProviderClient>{children}</WalletProviderClient>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}
