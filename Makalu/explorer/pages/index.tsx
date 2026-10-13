import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';
import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

import { FormattedValueElement } from '@/components/FormattedValueElement';
import SearchBar from '@/components/SearchBar';
import MarketOverview from '@/components/MarketOverview';
import SyncStatusBanner from '@/components/SyncStatusBanner';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE, POLL_INTERVAL } from '@/lib/constants';
import { formatNumber, timeAgo, truncateHash, formatValue, formatSupply, formatGasPrice } from '@/lib/format';
import { NETWORK, WALLET_CHAIN } from '@/lib/network';
import { getPreferredTxHash } from '@/lib/tx';

import type { StatsSummary, ApiBlock, ApiTxList, ApiValidator, ApiToken } from '@/lib/types';
import type { GetServerSideProps } from 'next';


const SSR_API_TIMEOUT_MS = 8_000;

interface HomeProps {
  initialStats: StatsSummary | null;
  initialValidators: ApiValidator[] | null;
}

// Web3Modal hooks cannot be called on the server — extract them into a
// client-only inner component that's conditionally rendered after mount.
function HomeContent({ initialStats, initialValidators }: HomeProps) {
  const { open } = useWeb3Modal();
  const { isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const [isAddingNetwork, setIsAddingNetwork] = useState(false);
  // Track if user clicked Add/Switch so we can auto-continue after wallet connects
  const pendingNetworkAdd = useRef(false);

  // After wallet connects, auto-add Makalu network if user had clicked the button
  useEffect(() => {
    if (isConnected && pendingNetworkAdd.current) {
      pendingNetworkAdd.current = false;
      promptNetworkAdd();
    }
  }, [isConnected]);

  /** Prompt wallet to switch/add Makalu network */
  async function promptNetworkAdd() {
    const provider = walletProvider ?? (window.ethereum as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined);
    if (!provider) return;

    if (Number(chainId) === NETWORK.evmChainId || !NETWORK.walletReady) return;

    setIsAddingNetwork(true);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORK.chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        // Chain not in wallet yet — add it
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [WALLET_CHAIN],
        });
      } else if (switchError?.code !== 4001) {
        console.error('Network switch error:', switchError);
      }
    } finally {
      setIsAddingNetwork(false);
    }
  }

  /** Main button handler: open web3modal if not connected, then add network natively */
  async function addOrSwitchNetwork() {
    if (Number(chainId) === NETWORK.evmChainId || !NETWORK.walletReady) return;

    if (!isConnected) {
      pendingNetworkAdd.current = true;
      await open({ view: 'Connect' });
      return;
    }

    await promptNetworkAdd();
  }

  const { data: stats, loading: statsLoading } = useApi<StatsSummary>('/stats/summary', {
    pollInterval: POLL_INTERVAL,
    initialData: initialStats ?? undefined,
  });
  const { data: blocks, loading: blocksLoading } = useApi<ApiBlock[]>('/blocks?limit=4', {
    pollInterval: POLL_INTERVAL,
  });
  const { data: txsData, loading: txsLoading } = useApi<ApiTxList>('/txs?limit=4', {
    pollInterval: POLL_INTERVAL,
  });
  const txs = txsData?.txs ?? [];
  const { data: validators } = useApi<ApiValidator[]>('/validators', {
    initialData: initialValidators ?? undefined,
  });

  const { data: tokensData, loading: tokensLoading } = useApi<ApiToken[]>('/tokens', {
    pollInterval: POLL_INTERVAL,
  });

  const topValidators = Array.isArray(validators) ? validators.slice(0, 4) : [];
  const isSyncing = Boolean(stats?.isSyncing);
  
  const topTokens = tokensData?.slice(0, 4) ?? [
    { symbol: 'LITHO', name: 'Lithosphere', type: 'native' },
    { symbol: 'wLITHO', name: 'Wrapped Lithosphere', type: 'LEP100' },
    { symbol: 'LAX', name: 'Lithosphere Algo', type: 'LEP100' },
    { symbol: 'AGII', name: 'Lithosphere AGII', type: 'LEP100' },
  ];

  const summaryStats: Array<{ label: string; value: string; subtitle?: string }> = [
    {
      label: isSyncing ? 'Indexed Block' : 'Latest Block',
      value: statsLoading ? '—' : `#${formatNumber(stats?.tipHeight ?? 0)}`,
    },
    {
      label: 'Validators',
      value: Array.isArray(validators) ? String(validators.length) : '—',
    },
    {
      label: 'Gas Price',
      value: statsLoading
        ? '—'
        : stats?.gasPriceWei
          ? formatGasPrice(stats.gasPriceWei)
          : '—',
    },
  ];

  const networkMetrics: Array<{ label: string; value: string; subtitle?: string }> = [
    {
      label: 'Average Block Time',
      value: statsLoading ? '—' : `${stats?.avgBlockTime ?? 0}s`,
    },
    {
      label: 'Total Transactions',
      value: statsLoading ? '—' : formatNumber(stats?.totalTransactions ?? 0),
    },
    {
      label: 'LITHO Holders',
      value: statsLoading ? '—' : formatNumber(stats?.currentHolders ?? 0),
    },
    {
      label: 'Total Addresses',
      value: statsLoading ? '—' : formatNumber(stats?.walletAddresses ?? 0),
      subtitle: 'all-time, incl. inactive',
    },
    {
      label: 'Gas Price',
      value: stats?.gasPriceWei ? formatGasPrice(stats.gasPriceWei) : '—',
    },
  ];

  return (
    <>
      <Head>
        <title>{EXPLORER_TITLE} | {NETWORK.label} Block Explorer</title>
        <meta
          name="description"
          content="Explore blocks, transactions, validators, and smart contracts on the Lithosphere blockchain."
        />
      </Head>

      <div className="w-full min-w-0 text-[var(--color-text-primary)]">

          {/* Hero */}
          <section className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-center">
            <div className="min-w-0">
              <div className="mb-3 inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
                {NETWORK.label}
              </div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                Explore blocks, contracts, AI activity, and LEP100 assets on {NETWORK.shortName}.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-text-secondary)] md:text-lg">
                A unified explorer for Lithosphere&apos;s dual-layer blockchain with validator
                intelligence, AI execution receipts, and real-time network
                analytics.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/blocks"
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-[#f8fafc] hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-white/90 transition"
                >
                  View Latest Blocks
                </Link>
                <Link
                  href="/txs"
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-5 py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 transition"
                >
                  View Latest Transactions
                </Link>
                <button
                  onClick={addOrSwitchNetwork}
                  disabled={!NETWORK.walletReady || isAddingNetwork || Number(chainId) === NETWORK.evmChainId}
                  className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition disabled:opacity-100 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20"
                >
                  {isAddingNetwork
                    ? 'Adding Network...'
                    : !NETWORK.walletReady
                      ? 'Mainnet RPC required'
                      : Number(chainId) === NETWORK.evmChainId
                        ? `✓ ${NETWORK.shortName} Connected`
                        : isConnected
                          ? `Switch to ${NETWORK.shortName}`
                          : `Add ${NETWORK.shortName} Network`}
                </button>
              </div>

              <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-black/30">
                <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">Global Search</div>
                <SearchBar fullWidth />
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {summaryStats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-3xl border border-white/10 bg-white/5 p-5"
                >
                  <div className="text-sm text-white/55">{item.label}</div>
                  <div className="mt-2 text-2xl font-semibold">{item.value}</div>
                  {item.subtitle && (
                    <div className="mt-1 text-xs text-white/45">{item.subtitle}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <MarketOverview />

          {/* Network metrics (real data from chain) */}
          <section className="mt-6 grid w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {networkMetrics.map((item) => (
              <div
                key={item.label}
                className="rounded-3xl border border-violet-200 bg-violet-50 p-5 dark:border-violet-400/15 dark:bg-violet-400/5"
              >
                <div className="text-sm font-medium text-violet-800 dark:text-violet-200/65">{item.label}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-violet-100">{item.value}</div>
                {item.subtitle && (
                  <div className="mt-1 text-xs text-violet-700 dark:text-violet-200/45">{item.subtitle}</div>
                )}
              </div>
            ))}
          </section>

          <SyncStatusBanner stats={stats} className="mt-6" />

          {/* Blocks + Transactions */}
          <section className="mt-8 grid w-full min-w-0 gap-6 2xl:mx-auto 2xl:max-w-[1560px] 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* Latest Blocks */}
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white/55">
                    {isSyncing ? 'Indexed Network Activity' : 'Live Network Activity'}
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold">Latest Blocks</h2>
                </div>
                <Link
                  href="/blocks"
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
                >
                  View all
                </Link>
              </div>

              <div className="space-y-3">
                {blocksLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 animate-pulse"
                      >
                        <div className="h-4 rounded bg-white/10 w-1/3 mb-2" />
                        <div className="h-3 rounded bg-white/10 w-2/3" />
                      </div>
                    ))
                  : (Array.isArray(blocks) ? blocks : []).map((block) => (
                      <div
                        key={block.height}
                        className="grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 xl:grid-cols-[auto_minmax(0,22.5rem)] xl:justify-between xl:gap-6 xl:items-center"
                      >
                        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                          <div className="shrink-0">
                            <div className="text-xs text-white/45">Height</div>
                            <Link
                              href={`/blocks/${block.height}`}
                              className="mt-1 block font-medium tabular-nums hover:text-emerald-300 transition"
                            >
                              #{formatNumber(block.height)}
                            </Link>
                          </div>
                          <div className="shrink-0">
                            <div className="text-xs text-white/45">Age</div>
                            <div className="mt-1 whitespace-nowrap font-medium tabular-nums">{timeAgo(block.timestamp)}</div>
                          </div>
                          <div className="shrink-0">
                            <div className="text-xs text-white/45">
                              <span className="sm:hidden">Txns</span>
                              <span className="hidden sm:inline">Transactions</span>
                            </div>
                            <div className="mt-1 font-medium tabular-nums">{block.txCount}</div>
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-2.5 xl:w-full xl:max-w-[22.5rem] xl:justify-self-end">
                          <div className="text-xs text-white/45">Hash</div>
                          <div
                            className="mt-1 truncate font-mono text-xs text-white/70 sm:text-sm"
                            title={block.hash ?? undefined}
                          >
                            {block.hash ? truncateHash(block.hash, 11, 7) : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            </div>

            {/* Latest Transactions */}
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white/55">
                    {isSyncing ? 'Indexed Feed' : 'Realtime Feed'}
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold">Latest Transactions</h2>
                </div>
                <Link
                  href="/txs"
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
                >
                  View all
                </Link>
              </div>

              <div className="space-y-3">
                {txsLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 animate-pulse"
                      >
                        <div className="h-4 rounded bg-white/10 w-1/2 mb-2" />
                        <div className="h-3 rounded bg-white/10 w-full" />
                      </div>
                    ))
                  : txs.map((tx) => {
                      const txHash = getPreferredTxHash(tx);
                      const methodLabel = tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer');
                      const txKey = txHash ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`;

                      return (
                      <div
                        key={txKey}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5"
                      >
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {txHash ? (
                              <Link
                                href={`/txs/${txHash}`}
                                className="block truncate font-mono text-sm font-medium text-emerald-300 transition hover:text-emerald-200 sm:text-[15px]"
                                title={txHash}
                              >
                                {truncateHash(txHash)}
                              </Link>
                            ) : (
                              <span className="block font-mono font-medium text-white/30">Unavailable</span>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
                              <span className="tabular-nums">Block #{formatNumber(tx.blockHeight)}</span>
                              {tx.timestamp && (
                                <span className="tabular-nums">{timeAgo(tx.timestamp)}</span>
                              )}
                            </div>
                          </div>
                          <span className="inline-flex max-w-full shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70" title={methodLabel}>
                            <span className="truncate">{methodLabel}</span>
                          </span>
                        </div>
                        <div className="mt-4 grid gap-x-6 gap-y-4 text-sm text-white/65 sm:grid-cols-2 xl:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_max-content] xl:justify-between xl:gap-x-8 xl:items-end 2xl:grid-cols-[minmax(0,15rem)_minmax(0,15rem)_max-content]">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white/55">From:</div>
                            <Link
                              href={`/address/${tx.fromAddr}`}
                              className="mt-1 block truncate font-mono text-[15px] text-white/85 transition hover:text-white sm:text-base"
                              title={tx.fromAddr}
                            >
                              {truncateHash(tx.fromAddr, 11, 6)}
                            </Link>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white/55">To:</div>
                            {tx.toAddr ? (
                              <Link
                                href={`/address/${tx.toAddr}`}
                                className="mt-1 block truncate font-mono text-[15px] text-white/85 transition hover:text-white sm:text-base"
                                title={tx.toAddr}
                              >
                                {truncateHash(tx.toAddr, 11, 6)}
                              </Link>
                            ) : (
                              <span className="mt-1 block text-sm text-white/35">--</span>
                            )}
                          </div>
                          <div className="min-w-0 sm:col-span-2 xl:col-span-1 xl:min-w-[9rem] xl:text-right">
                            <div className="text-sm font-medium text-white/55">Value:</div>
                            <div className="mt-1 min-w-0 text-[15px] text-white/90 sm:text-base">
                              <FormattedValueElement
                                formattedStr={tx.tokenTransferAmount
                                  ? (tx.tokenSymbol
                                      ? `${formatSupply(tx.tokenTransferAmount)} ${tx.tokenSymbol}`
                                      : formatSupply(tx.tokenTransferAmount))
                                  : formatValue(tx.value, tx.denom)}
                                tokenAddress={tx.contractAddress}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )})}
              </div>
            </div>
          </section>

          {/* Validators + Tokens + Dev tools */}
          <section className="mt-8 grid w-full min-w-0 gap-6 xl:grid-cols-3">
            {/* Top Validators */}
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white/55">Consensus Layer</div>
                  <h2 className="mt-1 text-2xl font-semibold">Top Validators</h2>
                </div>
                <Link
                  href="/validators"
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80 hover:bg-black/50 transition sm:px-4"
                >
                  All validators
                </Link>
              </div>

              <div className="space-y-3">
                {topValidators.length === 0
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 animate-pulse"
                      >
                        <div className="h-4 rounded bg-white/10 w-1/2 mb-2" />
                        <div className="h-3 rounded bg-white/10 w-3/4" />
                      </div>
                    ))
                  : topValidators.map((v) => (
                      <div
                        key={v.address}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4"
                      >
                        <div className="font-medium">{v.moniker}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-white/65">
                          <div>
                            Voting Power:{' '}
                            <span className="text-white">{v.votingPower} LITHO</span>
                          </div>
                          <div>
                            Commission:{' '}
                            <span className="text-white">{v.commission}</span>
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            </div>

            {/* Top Tokens */}
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white/55">Onchain Assets</div>
                  <h2 className="mt-1 text-2xl font-semibold">Top Assets</h2>
                </div>
                <Link
                  href="/tokens"
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
                >
                  View tokens
                </Link>
              </div>

              <div className="space-y-3">
                {tokensLoading && !tokensData
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 animate-pulse"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="h-4 rounded bg-white/10 w-1/4" />
                          <div className="h-4 rounded bg-white/10 w-1/4" />
                        </div>
                        <div className="h-4 rounded bg-white/10 w-1/2" />
                      </div>
                    ))
                  : topTokens.map((token: any) => (
                      <div
                        key={token.symbol}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <Link href={`/token/${token.contractAddress || 'native'}`} className="font-medium hover:text-emerald-300 transition">
                            {token.symbol}
                          </Link>
                          <div className="text-sm text-white/60">
                            Holders {token.holders != null ? formatNumber(token.holders) : '—'}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-white/65">
                          Supply: <span className="text-white">
                            {token.totalSupply && token.decimals != null
                              ? formatSupply(token.totalSupply, token.decimals)
                              : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
              </div>
            </div>

            {/* Developer tools */}
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-5">
                <div className="text-sm text-white/55">Developer Tools</div>
                <h2 className="mt-1 text-2xl font-semibold">Contracts &amp; AI</h2>
              </div>

              <div className="space-y-3">
                <a
                  href="https://lithiclang.ai/verifier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-2xl border border-white/10 bg-black/25 p-4 hover:bg-black/40 transition"
                >
                  <div className="font-medium">Verified Lithic Contracts</div>
                  <div className="mt-2 text-sm text-white/65">
                    Browse verified source, ABIs, events, and contract creators.
                  </div>
                </a>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="font-medium">AI Execution Receipts</div>
                  <div className="mt-2 text-sm text-white/65">
                    Inspect LEP100 receipts, provider proofs, and zk-verifiable AI executions.
                  </div>
                </div>

              </div>
            </div>
          </section>

          {/* CTA banner */}
          <section className="mt-8 w-full min-w-0 rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-transparent to-violet-500/10 p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="text-sm text-white/55">Developer Experience</div>
                <h2 className="mt-1 text-3xl font-semibold">
                  Build, verify, and explore Lithic contracts on {NETWORK.shortName}.
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-white/65">
                  Connect wallet, inspect onchain activity, verify LEP100 contracts, monitor AI
                  requests, and track validator performance from a single explorer
                  interface.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://lithiclang.ai/verifier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-white/90 transition"
                >
                  Open Contract Verifier
                </a>
                {NETWORK.faucetEnabled ? <Link
                  href="/faucet"
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  Get Testnet LITHO
                </Link> : <Link
                  href="/validators"
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  View Validators
                </Link>}
              </div>
            </div>
          </section>

      </div>
    </>
  );
}

export default function Home(props: HomeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <HomeContent {...props} />;
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async () => {
  const apiBase = process.env.API_INTERNAL_URL ?? 'http://api:4000';

  async function fetchJsonWithTimeout<T>(path: string): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      signal: AbortSignal.timeout(SSR_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  const [statsResult, validatorsResult] = await Promise.allSettled([
    fetchJsonWithTimeout<StatsSummary>('/api/stats/summary'),
    fetchJsonWithTimeout<ApiValidator[]>('/api/validators'),
  ]);

  return {
    props: {
      initialStats: statsResult.status === 'fulfilled' ? statsResult.value : null,
      initialValidators: validatorsResult.status === 'fulfilled' ? validatorsResult.value : null,
    },
  };
};
