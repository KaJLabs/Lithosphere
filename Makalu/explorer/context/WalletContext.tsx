import React, { createContext, useContext, useEffect, useState } from 'react';
import { ConnectorController } from '@web3modal/core';
import { createWeb3Modal, defaultConfig, useWeb3Modal, useWeb3ModalAccount, useDisconnect } from '@web3modal/ethers/react';

import { NETWORK } from '@/lib/network';
import { preferThanosConnectors } from '@/lib/thanos';

const PROJECT_ID = '4d5085c5fd29c034f63f9256013dcd09';

const chains = [
  {
    chainId: NETWORK.evmChainId,
    name: NETWORK.name,
    currency: 'LITHO',
    explorerUrl: NETWORK.siteUrl,
    rpcUrl: NETWORK.rpcUrl || 'http://127.0.0.1:8545',
  },
  // Kamet is a first-class chain for the bridge flow (lock/claim happen there
  // for Kamet-origin routes). Without it in this list, Web3Modal flags a
  // Kamet-connected wallet as "unsupported network" and nags the user to
  // switch back to Makalu on every connect/refresh.
  ...(!NETWORK.isMainnet && NETWORK.bridgeEnabled ? [{
    chainId: 900523,
    name: 'Lithosphere Kamet',
    currency: 'LITHO',
    explorerUrl: 'https://kamet.litho.ai',
    rpcUrl: 'https://rpc-3.litho.ai',
  },
  // Bridge destination chains. The lock always runs on a Lithosphere source
  // chain (Makalu/Kamet), so the wallet never has to sign here — but bridge
  // users routinely switch their wallet to a destination chain to import and
  // view the wrapped token after a transfer. Whitelisting these stops the
  // "app doesn't support your current network" popover from firing whenever a
  // wallet legitimately sits on Sepolia / Base / BNB.
  {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
    rpcUrl: 'https://sepolia.base.org',
  },
  {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    currency: 'tBNB',
    explorerUrl: 'https://testnet.bscscan.com',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
  }] : []),
];

const metadata = {
  name: `${NETWORK.label} Explorer`,
  description: `${NETWORK.label} Block Explorer`,
  url: NETWORK.siteUrl,
  icons: [`${NETWORK.siteUrl}${NETWORK.walletIconPath}`],
};

const ethersConfig = defaultConfig({
  metadata,
  enableEIP6963: true,
  enableInjected: true,
  enableCoinbase: true,
  rpcUrl: NETWORK.rpcUrl || 'http://127.0.0.1:8545',
  defaultChainId: NETWORK.evmChainId,
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
      // WalletConnect Explorer IDs, in display order. Trust Wallet IS already
      // featured here (any injected/WalletConnect wallet still works regardless).
      //
      // Thanos wallet (thanos.fi): it is an EIP-6963 injected wallet with RDNS
      // `fi.thanos.wallet` — NOT a WalletConnect-registry wallet (hence no entry
      // in featuredWalletIds, and the empty registry search). It is discovered
      // automatically via enableEIP6963/enableInjected above, so it already
      // appears in this modal and works for connect + signing on Makalu (700777).
      // First-class "Sign in with Thanos" (SIWE auth + session) is implemented
      // at /signin (components/ThanosSignIn.tsx via the `thanos-connect` SDK),
      // backed by the API's /api/auth/nonce + /api/auth/verify endpoints.
      featuredWalletIds: [
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
        '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
        'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e18e4a0eb6f0f94bd4', // Coinbase Wallet
      ],
      themeMode: NETWORK.defaultTheme,
      themeVariables: {
        '--w3m-accent': NETWORK.isMainnet ? '#4a90d9' : '#34d399',
      },
    });

    // EIP-6963 wallets are shown in announcement order by Web3Modal. Keep the
    // Lithosphere-native Thanos wallet first without hiding any other wallet.
    const preferThanos = () => queueMicrotask(() => preferThanosConnectors(ConnectorController));
    preferThanos();
    ConnectorController.subscribeKey('connectors', preferThanos);
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
