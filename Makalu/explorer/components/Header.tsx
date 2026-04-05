import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useRef, useEffect } from 'react';
import {
  useWeb3Modal,
  useWeb3ModalAccount,
  useWeb3ModalProvider,
  useDisconnect,
} from '@web3modal/ethers/react';
import SearchBar from './SearchBar';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatValue } from '@/lib/format';

type EthereumRequestProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const MAKALU_CHAIN_ID = 700777;
const BALANCE_POLL_INTERVAL_MS = 15000;

interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Blocks', href: '/blocks' },
  { label: 'Transactions', href: '/txs' },
  { label: 'Tokens', href: '/tokens' },
  { label: 'Faucet', href: '/faucet' },
];

const MORE_ITEMS: NavItem[] = [
  { label: 'Docs', href: 'https://docs.litho.ai', external: true },
  { label: 'LITHO TGE', href: 'https://deals.litho.ai', external: true },
  { label: 'LITHO.ai', href: 'https://litho.ai', external: true },
  { label: 'ACCESS', href: 'https://access.litho.ai', external: true },
  { label: 'Validators', href: 'https://validator.litho.ai', external: true },
  { label: 'Governance', href: 'https://vote.litho.ai', external: true },
  { label: 'Contracts', href: 'https://lithiclang.ai/verifier', external: true },
  { label: 'Status', href: 'https://status.litho.ai', external: true },
];

function shortenAddress(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function Header() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [lithoBalance, setLithoBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const { open } = useWeb3Modal();
  const { disconnect } = useDisconnect();
  const { address, isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const isOnMakalu = chainId === MAKALU_CHAIN_ID;
  const balanceText = balanceLoading ? 'Refreshing...' : (lithoBalance ?? 'Unavailable');

  const isActive = (href: string) => {
    if (href === '/') return router.pathname === '/';
    return router.pathname.startsWith(href);
  };

  // Close "More" dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setWalletMenuOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!isConnected) {
      setWalletMenuOpen(false);
    }
  }, [isConnected]);

  // Auto-fetch native LITHO balance for the connected account and keep it fresh.
  useEffect(() => {
    if (!isConnected || !address) {
      setLithoBalance(null);
      setBalanceLoading(false);
      return;
    }

    let cancelled = false;

    const fetchBalance = async (showLoader: boolean) => {
      if (showLoader && !cancelled) {
        setBalanceLoading(true);
      }

      try {
        let hexBalance: string | null = null;

        const injectedProvider =
          typeof window !== 'undefined'
            ? (window as Window & { ethereum?: EthereumRequestProvider }).ethereum
            : undefined;

        const provider =
          (walletProvider as EthereumRequestProvider | undefined) ?? injectedProvider;

        if (provider?.request && chainId === MAKALU_CHAIN_ID) {
          const result = await provider.request({
            method: 'eth_getBalance',
            params: [address, 'latest'],
          });
          if (typeof result === 'string') {
            hexBalance = result;
          }
        }

        // Fallback to public RPC to keep balance visible even when wallet is on another chain.
        if (!hexBalance) {
          const response = await fetch('https://rpc.litho.ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getBalance',
              params: [address, 'latest'],
              id: 1,
            }),
          });

          if (response.ok) {
            const data: { result?: unknown } = await response.json();
            if (typeof data.result === 'string') {
              hexBalance = data.result;
            }
          }
        }

        if (!hexBalance) {
          throw new Error('Balance unavailable');
        }

        const normalizedHex = hexBalance.startsWith('0x') ? hexBalance : `0x${hexBalance}`;
        const wei = BigInt(normalizedHex);
        const formattedBalance = formatValue(wei.toString());

        if (!cancelled) {
          setLithoBalance(formattedBalance);
        }
      } catch (error) {
        console.error('Failed to fetch LITHO balance:', error);
        if (!cancelled) {
          setLithoBalance(null);
        }
      } finally {
        if (showLoader && !cancelled) {
          setBalanceLoading(false);
        }
      }
    };

    void fetchBalance(true);

    const intervalId = setInterval(() => {
      void fetchBalance(false);
    }, BALANCE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [address, chainId, isConnected, walletProvider]);

  return (
    <header className="sticky top-0 z-50 overflow-x-hidden border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <img
              src="/litho-logo.png"
              alt="Lithosphere"
              className="h-8 w-auto"
            />
            <span className="font-bold text-lg text-[var(--color-text-primary)] hidden sm:block">
              {EXPLORER_TITLE}
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'text-litho-400 bg-litho-400/10'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                {item.label}
              </Link>
            ))}

            {/* More dropdown */}
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  moreOpen
                    ? 'text-litho-400 bg-litho-400/10'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                More
                <svg className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/10 bg-[var(--color-bg-secondary)] shadow-xl shadow-black/40 py-1 z-50">
                  {MORE_ITEMS.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center justify-between px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    >
                      {item.label}
                      <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Search + Wallet + Mobile menu */}
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden md:block">
              <SearchBar />
            </div>

            {isConnected && (
              <div className="hidden 2xl:flex max-w-[220px] items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-xs">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                    isOnMakalu
                      ? 'bg-emerald-400/15 text-emerald-300'
                      : 'bg-amber-400/15 text-amber-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isOnMakalu ? 'bg-emerald-300' : 'bg-amber-300'
                    }`}
                  />
                  {isOnMakalu ? 'Makalu' : 'Network'}
                </span>
                <span className="truncate font-semibold text-white">{balanceText}</span>
              </div>
            )}

            {/* Wallet button + menu */}
            <div className="hidden sm:block">
              <button
                type="button"
                onClick={() => {
                  if (!isConnected) {
                    void open({ view: 'Connect' });
                    return;
                  }
                  setWalletMenuOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white transition hover:border-white/20 hover:bg-black/40"
              >
                {isConnected && (
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOnMakalu ? 'bg-emerald-300' : 'bg-amber-300'
                    }`}
                  />
                )}
                <span className="font-medium">
                  {isConnected ? shortenAddress(address) : 'Connect Wallet'}
                </span>
                {isConnected && (
                  <span className="max-w-[96px] truncate text-xs text-white/60">
                    {balanceText}
                  </span>
                )}
              </button>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)]"
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <div className="lg:hidden pb-4 space-y-1">
            <div className="md:hidden mb-3">
              <SearchBar />
            </div>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive(item.href)
                    ? 'text-litho-400 bg-litho-400/10'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                {item.label}
              </Link>
            ))}
            {/* More section (flat list on mobile) */}
            <div className="pt-2 border-t border-white/5">
              <div className="px-3 py-1 text-xs text-white/30 uppercase tracking-wider">More</div>
              {MORE_ITEMS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 rounded-md text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                >
                  {item.label}
                </a>
              ))}
            </div>
            {/* Mobile wallet connect */}
            <div className="pt-2 pb-1 px-3">
              {!isConnected ? (
                <button
                  type="button"
                  onClick={() => {
                    void open({ view: 'Connect' });
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/20"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-xl border border-white/10 bg-[var(--color-bg-tertiary)] px-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-white/70">{shortenAddress(address)}</span>
                      <span className="text-white/40">LITHO</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">{balanceText}</div>
                  </div>
                  {address && (
                    <Link
                      href={`/address/${address}`}
                      onClick={() => setMenuOpen(false)}
                      className="block w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-center text-sm text-white/85 transition hover:border-white/20"
                    >
                      View Wallet
                    </Link>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void open({ view: 'Networks' });
                      }}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85 transition hover:border-white/20"
                    >
                      Networks
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setMenuOpen(false);
                        await disconnect();
                      }}
                      className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300 transition hover:bg-red-400/10"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {walletMenuOpen && isConnected && address && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-24 backdrop-blur-[1px]"
          onClick={() => setWalletMenuOpen(false)}
        >
          <div
            ref={walletMenuRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/60"
          >
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/45">Connected Wallet</div>
                  <div className="mt-2 rounded-full border border-white/10 bg-black/30 px-4 py-2 font-mono text-lg text-white/90">
                    {shortenAddress(address)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletMenuOpen(false)}
                  className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close wallet menu"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                    isOnMakalu
                      ? 'bg-emerald-400/15 text-emerald-300'
                      : 'bg-amber-400/15 text-amber-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isOnMakalu ? 'bg-emerald-300' : 'bg-amber-300'
                    }`}
                  />
                  {isOnMakalu ? 'Makalu Testnet' : 'Switch Network'}
                </span>
                <span className="font-semibold text-white">{balanceText}</span>
              </div>
            </div>

            <div className="p-3">
              <Link
                href={`/address/${address}`}
                onClick={() => setWalletMenuOpen(false)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
              >
                View on Explorer
                <span className="text-white/40">↗</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setWalletMenuOpen(false);
                  void open({ view: 'Networks' });
                }}
                className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
              >
                Networks
                <span className="text-white/40">→</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setWalletMenuOpen(false);
                  await disconnect();
                }}
                className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm text-red-300 transition hover:bg-red-400/10 hover:text-red-200"
              >
                Disconnect
                <span className="text-red-300/70">×</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
