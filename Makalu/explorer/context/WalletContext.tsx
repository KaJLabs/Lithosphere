import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  open: (options?: { view?: string }) => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function parseChainId(caip2: string | undefined): number | null {
  if (!caip2) return null;
  const part = caip2.replace(/^eip155:/, '');
  const n = parseInt(part, 10);
  return isNaN(n) ? null : n;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  const activeWallet = wallets[0] ?? null;
  const address = activeWallet?.address ?? null;
  const chainId = parseChainId(activeWallet?.chainId);

  const value: WalletContextType = {
    address,
    isConnected: authenticated && !!address,
    chainId,
    open: async () => { login(); },
    disconnect: async () => { await logout(); },
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
