import {
  useWeb3Modal,
  useWeb3ModalAccount,
  useWeb3ModalProvider,
  useDisconnect,
} from '@web3modal/ethers/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { apiFetch } from '@/lib/api';
import { formatValue, preferLitho } from '@/lib/format';
import { NETWORK } from '@/lib/network';

import BrandLogo from './BrandLogo';
import SearchBar from './SearchBar';
import ThemeToggle from './ThemeToggle';

const THANOS_SESSION_KEY = 'thanos_session';

type EthereumRequestProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

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
  { label: 'NFTs', href: '/nfts' },
  { label: 'Swap', href: '/swap' },
  { label: 'Faucet', href: '/faucet' },
  { label: 'Validators', href: '/validators' },
  { label: 'Ignite DEX', href: 'https://ignite.trade', external: true },
];

const MORE_ITEMS: NavItem[] = [
  { label: 'Quantt Research', href: '/quantt' },
  { label: 'Docs', href: 'https://docs.litho.ai', external: true },
  { label: 'Makalu Testnet', href: 'https://makalu.litho.ai', external: true },
  { label: 'Kamet Testnet', href: 'https://kamet.litho.ai', external: true },
  { label: 'LITHO TGE', href: 'https://tge.ignite.trade', external: true },
  { label: 'LITHO.ai', href: 'https://litho.ai', external: true },
  { label: 'ACCESS', href: 'https://access.litho.ai', external: true },
  { label: 'Governance', href: 'https://vote.litho.ai', external: true },
  { label: 'Contracts', href: 'https://lithiclang.ai/verifier', external: true },
  { label: 'Status', href: 'https://status.litho.ai', external: true },
];

function shortenAddress(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length < 12) return value;
  // `litho1` is shared by every bech32 address, so keep a longer head or they
  // all collapse to the same `litho1...` label.
  const head = value.startsWith('litho1') ? 10 : 6;
  return `${value.slice(0, head)}...${value.slice(-4)}`;
}

function HeaderContent() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [lithoBalance, setLithoBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [thanosSignedIn, setThanosSignedIn] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuScrollRef = useRef<HTMLDivElement>(null);
  const mobileMenuTouchStartYRef = useRef(0);
  const { open } = useWeb3Modal();
  const { disconnect } = useDisconnect();
  const { address, isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const isOnNetwork = chainId === NETWORK.evmChainId;
  // Litho-first: surface the native bech32 identity everywhere the wallet is
  // shown. Falls back to the raw 0x value if conversion ever fails.
  const lithoAddress = preferLitho(address);
  const balanceText = balanceLoading ? 'Refreshing...' : (lithoBalance ?? 'Unavailable');

  const isActive = (href: string) => {
    if (href === '/') return router.pathname === '/';
    return router.pathname.startsWith(href);
  };

  // Global listener for wallet menu
  useEffect(() => {
    const handleOpenWalletMenu = () => setWalletMenuOpen(true);
    window.addEventListener('open-wallet-menu', handleOpenWalletMenu);
    return () => window.removeEventListener('open-wallet-menu', handleOpenWalletMenu);
  }, []);

  // Reflect the Thanos SIWE session (persisted by ThanosSignIn in localStorage)
  // so the "Sign In" nav link updates to "Signed In" without a page reload.
  useEffect(() => {
    const readSession = () => {
      try {
        const raw = localStorage.getItem(THANOS_SESSION_KEY);
        if (!raw) {
          setThanosSignedIn(false);
          return;
        }
        const session = JSON.parse(raw) as { expiresAt?: number | null };
        setThanosSignedIn(!session.expiresAt || session.expiresAt * 1000 > Date.now());
      } catch {
        setThanosSignedIn(false);
      }
    };

    readSession();
    window.addEventListener('thanos-session-changed', readSession);
    window.addEventListener('storage', readSession);
    return () => {
      window.removeEventListener('thanos-session-changed', readSession);
      window.removeEventListener('storage', readSession);
    };
  }, []);

  // A connected wallet OR a persisted Thanos SIWE session both count as signed in.
  // Once signed in, hide the "Sign In" nav link entirely (the wallet pill already
  // shows the account) rather than leaving a redundant button in the nav.
  const isSignedIn = thanosSignedIn || isConnected;
  const navItems = NAV_ITEMS.filter((item) => {
    if (isSignedIn && item.href === '/signin') return false;
    if (!NETWORK.faucetEnabled && item.href === '/faucet') return false;
    if (!NETWORK.bridgeEnabled && item.href === '/bridge') return false;
    if (!NETWORK.swapEnabled && item.href === '/swap') return false;
    return true;
  });

  // Close "More" dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (moreRef.current?.contains(target)) return;
      if (moreMenuRef.current?.contains(target)) return;
      setMoreOpen(false);
    }
    if (moreOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;

    const updateMoreMenuPosition = () => {
      const trigger = moreRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      setMoreMenuPosition({
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    };

    updateMoreMenuPosition();
    window.addEventListener('resize', updateMoreMenuPosition);
    window.addEventListener('scroll', updateMoreMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMoreMenuPosition);
      window.removeEventListener('scroll', updateMoreMenuPosition, true);
    };
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
    if (!menuOpen) return;

    const scrollY = window.scrollY;
    const scrollContainer = mobileMenuScrollRef.current;
    const appRoot = document.getElementById('__next');
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyHeight = document.body.style.height;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlHeight = document.documentElement.style.height;
    const previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;
    const previousAppRootPointerEvents = appRoot?.style.pointerEvents ?? '';

    const handleTouchStart = (event: TouchEvent) => {
      mobileMenuTouchStartYRef.current = event.touches[0]?.clientY ?? 0;
    };

    const handleTouchMoveWithinMenu = (event: TouchEvent) => {
      if (!scrollContainer) {
        event.preventDefault();
        return;
      }

      const currentY = event.touches[0]?.clientY ?? mobileMenuTouchStartYRef.current;
      const deltaY = currentY - mobileMenuTouchStartYRef.current;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if (
        scrollHeight <= clientHeight ||
        (atTop && deltaY > 0) ||
        (atBottom && deltaY < 0)
      ) {
        event.preventDefault();
      }

      event.stopPropagation();
    };

    const preventBackgroundTouchMove = (event: TouchEvent) => {
      const target = event.target as Node | null;

      if (!scrollContainer || !target || !scrollContainer.contains(target)) {
        event.preventDefault();
      }
    };

    const preventBackgroundWheel = (event: WheelEvent) => {
      const target = event.target as Node | null;

      if (!scrollContainer || !target || !scrollContainer.contains(target)) {
        event.preventDefault();
      }
    };

    const keepWindowScrollLocked = () => {
      if (window.scrollY !== scrollY) {
        window.scrollTo(0, scrollY);
      }
    };

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100dvh';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.height = '100dvh';
    document.body.style.overscrollBehavior = 'none';

    if (appRoot) {
      appRoot.style.pointerEvents = 'none';
    }

    scrollContainer?.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollContainer?.addEventListener('touchmove', handleTouchMoveWithinMenu, { passive: false });
    document.addEventListener('touchmove', preventBackgroundTouchMove, { passive: false });
    document.addEventListener('wheel', preventBackgroundWheel, { passive: false });
    window.addEventListener('scroll', keepWindowScrollLocked);

    return () => {
      scrollContainer?.removeEventListener('touchstart', handleTouchStart);
      scrollContainer?.removeEventListener('touchmove', handleTouchMoveWithinMenu);
      document.removeEventListener('touchmove', preventBackgroundTouchMove);
      document.removeEventListener('wheel', preventBackgroundWheel);
      window.removeEventListener('scroll', keepWindowScrollLocked);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.height = previousHtmlHeight;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.height = previousBodyHeight;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      if (appRoot) {
        appRoot.style.pointerEvents = previousAppRootPointerEvents;
      }
      window.scrollTo(0, scrollY);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

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

      const toWei = (value: string): bigint =>
        BigInt(value.startsWith('0x') ? value : `0x${value}`);

      try {
        let wei: bigint | null = null;

        const injectedProvider =
          typeof window !== 'undefined'
            ? (window as Window & { ethereum?: EthereumRequestProvider }).ethereum
            : undefined;

        const provider =
          (walletProvider as EthereumRequestProvider | undefined) ?? injectedProvider;

        // 1) Same-origin API first — proven reliable for every address form
        //    (bech32, lowercase and checksummed 0x). nginx proxies /api → Express,
        //    which resolves the live native balance server-side, so this avoids the
        //    CORS failures a direct browser POST to rpc.litho.ai hits from the
        //    makalu.litho.ai origin (the original cause of "Unavailable"). Trying it
        //    first also means a stalled wallet provider can't block the display.
        try {
          const data = await apiFetch<{ balance?: string; balanceSource?: string }>(
            `/address/${address}`,
          );
          if (data.balanceSource !== 'unavailable' && typeof data.balance === 'string') {
            wei = BigInt(data.balance);
          }
        } catch {
          /* fall through to the wallet/RPC fallbacks */
        }

        // 2) Cross-check via the connected wallet only if the API gave nothing.
        if (wei === null && provider?.request && chainId === NETWORK.evmChainId) {
          try {
            const result = await provider.request({
              method: 'eth_getBalance',
              params: [address, 'latest'],
            });
            if (typeof result === 'string') wei = toWei(result);
          } catch {
            /* fall through to the public RPC fallback */
          }
        }

        // 3) Last resort: direct public RPC (works only where CORS is permitted).
        if (wei === null) {
          try {
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
              if (typeof data.result === 'string') wei = toWei(data.result);
            }
          } catch {
            /* keep the last-known balance below */
          }
        }

        if (!cancelled && wei !== null) {
          setLithoBalance(formatValue(wei.toString()));
        }
        // On a transient miss we intentionally keep the last-known balance rather
        // than flashing "Unavailable" until the next poll succeeds.
      } catch (error) {
        console.error('Failed to fetch LITHO balance:', error);
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

  const balanceDisplay = balanceLoading
    ? '...'
    : lithoBalance
      ? lithoBalance.replace(/\s*LITHO$/, '')
      : '0.000';

  const walletOverlay = walletMenuOpen && isConnected && address ? (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/60 p-4 pt-16 backdrop-blur-[1px]"
      onClick={() => setWalletMenuOpen(false)}
    >
      <div
        ref={walletMenuRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/20"
      >
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/65">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5l7 4-7 4-7-4 7-4zm0 7l7 4-7 4-7-4 7-4z" />
                </svg>
              </span>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </div>
            <button
              type="button"
              onClick={() => setWalletMenuOpen(false)}
              className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close wallet menu"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mx-auto mt-2 w-fit max-w-full rounded-[100px] border border-white/5 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.05]">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-200 to-violet-500 shadow-[0_0_24px_rgba(168,85,247,0.35)]" />
              <span className="font-semibold text-lg tracking-tight text-white/90" title={lithoAddress}>
                {shortenAddress(lithoAddress)}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(lithoAddress);
                  } catch {
                    // no-op
                  }
                }}
                className="ml-auto rounded p-1 text-white/55 transition hover:bg-white/10 hover:text-white"
                aria-label="Copy address"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-5 text-center text-4xl font-semibold text-white/90 tracking-tight">{`\u{1D543}${balanceDisplay}`}</div>

          <Link
            href={`/address/${lithoAddress}`}
            onClick={() => setWalletMenuOpen(false)}
            className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-white/30">
              <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            </span>
            Block Explorer
            <span className="text-white/70">↗</span>
          </Link>

          <div className="mt-5 space-y-1.5">
            <a
              href="https://tge.ignite.trade"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setWalletMenuOpen(false)}
              className="flex w-full items-center justify-between rounded-2xl bg-white/[0.02] px-4 py-3 text-left text-[15px] font-medium text-white/90 transition hover:bg-white/[0.06]"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="4" y="6" width="16" height="12" rx="2" />
                    <path d="M8 12h.01" />
                  </svg>
                </span>
                Buy crypto
              </span>
              <span className="text-white/45 text-xl leading-none">›</span>
            </a>

            {NETWORK.swapEnabled && <Link
              href="/swap"
              onClick={() => setWalletMenuOpen(false)}
              className="flex w-full items-center justify-between rounded-2xl bg-white/[0.02] px-4 py-3 text-left text-[15px] font-medium text-white/90 transition hover:bg-white/[0.06]"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M4 7h11l-3-3m8 13H9l3 3" />
                  </svg>
                </span>
                Swap
              </span>
              <span className="text-white/45 text-xl leading-none">›</span>
            </Link>}

            <Link
              href={`/address/${lithoAddress}`}
              onClick={() => setWalletMenuOpen(false)}
              className="flex w-full items-center justify-between rounded-2xl bg-white/[0.02] px-4 py-3 text-left text-[15px] font-medium text-white/90 transition hover:bg-white/[0.06]"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4l2 2" />
                  </svg>
                </span>
                Activity
              </span>
              <span className="text-white/45 text-xl leading-none">›</span>
            </Link>

            <button
              type="button"
              onClick={async () => {
                setWalletMenuOpen(false);
                await disconnect();
              }}
              className="flex w-full items-center justify-between rounded-2xl bg-white/[0.02] px-4 py-3 text-left text-[15px] font-medium text-white/50 transition hover:bg-white/[0.06] hover:text-white/85"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/50">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M10 17l5-5-5-5" />
                    <path d="M15 12H3" />
                    <path d="M13 5h6v14h-6" />
                  </svg>
                </span>
                Disconnect
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const moreMenu =
    moreOpen && moreMenuPosition ? (
      <div
        ref={moreMenuRef}
        className="fixed z-[130] w-48 rounded-xl border border-white/10 bg-[var(--color-bg-secondary)] py-1 shadow-xl shadow-black/40"
        style={{ top: moreMenuPosition.top, right: moreMenuPosition.right }}
      >
        {MORE_ITEMS.map((item) => item.external ? (
          <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center justify-between px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]">
            {item.label}<svg className="h-3 w-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
        ) : (
          <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className="flex items-center px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]">{item.label}</Link>
        ))}
      </div>
    ) : null;

  const mobileMenu = menuOpen ? (
    <div
      ref={mobileMenuScrollRef}
      className="fixed inset-0 z-[150] overflow-y-auto overscroll-contain bg-[var(--color-bg-primary)] px-4 pb-8 pt-5 touch-pan-y lg:hidden"
      style={{ height: '100dvh', WebkitOverflowScrolling: 'touch' }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3"
        >
          <BrandLogo />
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]"
          aria-label="Close menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mx-auto mt-7 max-w-7xl space-y-5">
        <div className="md:hidden">
          <SearchBar onNavigate={() => setMenuOpen(false)} />
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noopener noreferrer' : undefined}
              onClick={() => setMenuOpen(false)}
              className={`block rounded-xl px-4 py-3 text-base font-semibold ${
                isActive(item.href)
                  ? 'bg-litho-400/12 text-litho-300'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 pt-4">
          <div className="px-4 pb-2 text-xs font-medium uppercase tracking-[0.18em] text-white/35">More</div>
          <div className="space-y-1">
            {MORE_ITEMS.map((item) => item.external ? (
              <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-base font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]">{item.label}</a>
            ) : (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-base font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]">{item.label}</Link>
            ))}
          </div>
        </div>

        <div className="pt-1">
          {!isConnected ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void open({ view: 'Connect' });
              }}
              className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] transition hover:border-litho-400"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-white/75" title={lithoAddress}>{shortenAddress(lithoAddress)}</span>
                  <span className="text-white/45">LITHO</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-white">{balanceText}</div>
              </div>
              {address && (
                <Link
                  href={`/address/${lithoAddress}`}
                  onClick={() => setMenuOpen(false)}
                  className="block w-full rounded-2xl border border-white/10 bg-[#141927] px-4 py-3 text-center text-sm text-white/85 transition hover:border-white/20 hover:bg-[#1b2132]"
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
                  className="rounded-2xl border border-white/10 bg-[#141927] px-3 py-2.5 text-sm text-white/85 transition hover:border-white/20 hover:bg-[#1b2132]"
                >
                  Networks
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await disconnect();
                  }}
                  className="rounded-2xl border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-sm text-red-200 transition hover:bg-red-400/15"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" aria-label={`${NETWORK.explorerTitle} home`}><BrandLogo /></Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
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
            </div>
          </nav>

          {/* Search + Wallet + Mobile menu */}
          <div className="flex min-w-0 items-center gap-2">
            <ThemeToggle />
            <div className="hidden min-w-0 shrink md:block">
              <SearchBar onNavigate={() => setMenuOpen(false)} />
            </div>

            {/* Wallet button + menu */}
            <div className="hidden min-w-0 sm:block">
              <button
                type="button"
                onClick={() => {
                  if (!isConnected) {
                    void open({ view: 'Connect' });
                    return;
                  }
                  setWalletMenuOpen((prev) => !prev);
                }}
                className="inline-flex min-w-0 max-w-[15rem] items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white transition hover:border-white/20 hover:bg-black/40"
              >
                {isConnected && (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isOnNetwork ? 'bg-emerald-300' : 'bg-amber-300'
                    }`}
                  />
                )}
                <span className="min-w-0 truncate font-medium" title={isConnected ? lithoAddress : undefined}>
                  {isConnected ? shortenAddress(lithoAddress) : 'Connect Wallet'}
                </span>
                {/* bech32 labels are wider than 0x ones, so the balance only
                    rides along once there is room for it. It is always visible
                    in the wallet menu. */}
                {isConnected && (
                  <span className="hidden max-w-[96px] shrink-0 truncate text-xs text-white/60 xl:inline">
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
      </div>

      {moreMenu && typeof document !== 'undefined' ? createPortal(moreMenu, document.body) : null}
      {mobileMenu && typeof document !== 'undefined' ? createPortal(mobileMenu, document.body) : null}
      {walletOverlay && typeof document !== 'undefined' ? createPortal(walletOverlay, document.body) : null}
    </header>
  );
}

export default function Header() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Render a same-height placeholder on the server to prevent layout shift
  if (!mounted) return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex h-16 items-center justify-between" />
      </div>
    </header>
  );
  return <HeaderContent />;
}
