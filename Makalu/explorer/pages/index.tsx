import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE, POLL_INTERVAL } from '@/lib/constants';
import { formatNumber, timeAgo, truncateHash, formatValue, formatSupply } from '@/lib/format';
import { getPreferredTxHash } from '@/lib/tx';
import type { StatsSummary, ApiBlock, ApiTxList, ApiValidator, ApiToken } from '@/lib/types';
import SearchBar from '@/components/SearchBar';
import SyncStatusBanner from '@/components/SyncStatusBanner';
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';
import { useState, useEffect, useRef } from 'react';
import { FormattedValueElement } from '@/components/FormattedValueElement';


const MAKALU_CHAIN = {
  chainId: '0xab169',
  chainName: 'Lithosphere Makalu Testnet',
  rpcUrls: ['https://rpc.litho.ai'],
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  blockExplorerUrls: ['https://makalu.litho.ai'],
};

const MAKALU_CHAIN_ID = parseInt(MAKALU_CHAIN.chainId, 16); // 700777
const SSR_API_TIMEOUT_MS = 8_000;

interface HomeProps {
  initialStats: StatsSummary | null;
  initialValidators: ApiValidator[] | null;
}

export default function Home({ initialStats, initialValidators }: HomeProps) {
  const { open } = useWeb3Modal();
  const { address, isConnected, chainId } = useWeb3ModalAccount();
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

    if (Number(chainId) === MAKALU_CHAIN_ID) return; // already on Makalu

    setIsAddingNetwork(true);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: MAKALU_CHAIN.chainId }],
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        // Chain not in wallet yet — add it
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [MAKALU_CHAIN],
        });
      } else if (switchError?.code !== 4001) {
        console.error('Network switch error:', switchError);
      }
    } finally {
      setIsAddingNetwork(false);
    }
  }

  /** Main button handler: open web3modal if not connected, then add network natively */
  async function addOrSwitchMakalu() {
    if (Number(chainId) === MAKALU_CHAIN_ID) return;

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
    { label: 'Gas Price', value: '1 Strat' },
  ];

  const networkMetrics = [
    {
      label: 'Average Block Time',
      value: statsLoading ? '—' : `${stats?.avgBlockTime ?? 0}s`,
    },
    {
      label: 'Total Transactions',
      value: statsLoading ? '—' : formatNumber(stats?.totalTransactions ?? 0),
    },
    {
      label: 'Wallet Addresses',
      value: statsLoading ? '—' : formatNumber(stats?.walletAddresses ?? 0),
    },
    {
      label: 'Gas Tracker',
      value: '< $0.01',
    },
  ];

  return (
    <>
      <Head>
        <title>{EXPLORER_TITLE} - Lithosphere Makalu Explorer</title>
        <meta
          name="description"
          content="Explore blocks, transactions, validators, and smart contracts on the Lithosphere blockchain."
        />
      </Head>

      <div className="text-white">

          {/* Hero */}
          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
            <div>
              <div className="mb-3 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                Lithosphere Makalu Testnet
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
                Explore blocks, contracts, AI activity, and LEP100 assets on Makalu.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/65 md:text-lg">
                A unified explorer for Lithosphere&apos;s dual-layer blockchain with validator
                intelligence, AI execution receipts, bridge activity, and real-time network
                analytics.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/blocks"
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-white/90 transition"
                >
                  View Latest Blocks
                </Link>
                <Link
                  href="/txs"
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  View Latest Transactions
                </Link>
                <button
                  onClick={addOrSwitchMakalu}
                  disabled={isAddingNetwork || Number(chainId) === MAKALU_CHAIN_ID}
                  className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-sm font-medium text-emerald-300 hover:bg-emerald-400/20 transition disabled:opacity-60"
                >
                  {isAddingNetwork
                    ? 'Adding Network...'
                    : Number(chainId) === MAKALU_CHAIN_ID
                      ? '✓ Makalu Connected'
                      : isConnected
                        ? 'Switch to Makalu'
                        : 'Add Makalu Network'}
                </button>
              </div>

              <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-black/30">
                <div className="mb-3 text-sm text-white/55">Global Search</div>
                <SearchBar />
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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

          {/* Network metrics (real data from chain) */}
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {networkMetrics.map((item) => (
              <div
                key={item.label}
                className="rounded-3xl border border-violet-400/15 bg-violet-400/5 p-5"
              >
                <div className="text-sm text-violet-200/65">{item.label}</div>
                <div className="mt-2 text-2xl font-semibold text-violet-100">{item.value}</div>
              </div>
            ))}
          </section>

          <SyncStatusBanner stats={stats} className="mt-6" />

          {/* Blocks + Transactions */}
          <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            {/* Latest Blocks */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm text-white/55">
                    {isSyncing ? 'Indexed Network Activity' : 'Live Network Activity'}
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold">Latest Blocks</h2>
                </div>
                <Link
                  href="/blocks"
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
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
                        className="grid gap-x-4 gap-y-3 rounded-2xl border border-white/10 bg-black/25 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1fr)] lg:items-center"
                      >
                        <div className="min-w-0">
                          <div className="text-xs text-white/45">Height</div>
                          <Link
                            href={`/blocks/${block.height}`}
                            className="mt-1 block font-medium hover:text-emerald-300 transition"
                          >
                            #{formatNumber(block.height)}
                          </Link>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-white/45">Age</div>
                          <div className="mt-1 font-medium">{timeAgo(block.timestamp)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-white/45">Transactions</div>
                          <div className="mt-1 font-medium">{block.txCount}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-white/45">Hash</div>
                          <div
                            className="mt-1 truncate font-mono text-xs text-white/70 sm:text-sm"
                            title={block.hash ?? undefined}
                          >
                            {block.hash ? truncateHash(block.hash) : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            </div>

            {/* Latest Transactions */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm text-white/55">
                    {isSyncing ? 'Indexed Feed' : 'Realtime Feed'}
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold">Latest Transactions</h2>
                </div>
                <Link
                  href="/txs"
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
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
                      const txKey = txHash ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`;
                      return (
                      <div
                        key={txKey}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          {txHash ? (
                            <Link
                              href={`/txs/${txHash}`}
                              className="font-mono font-medium hover:text-emerald-300 transition"
                            >
                              {truncateHash(txHash)}
                            </Link>
                          ) : (
                            <span className="font-mono font-medium text-white/30">Unavailable</span>
                          )}
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70 truncate max-w-[120px]" title={tx.methodName ?? tx.txType ?? 'Transfer'}>
                            {tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer')}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-white/65 sm:grid-cols-3">
                          <div>
                            From:{' '}
                            <span className="text-white font-mono">
                              {truncateHash(tx.fromAddr)}
                            </span>
                          </div>
                          <div>
                            To:{' '}
                            <span className="text-white font-mono">
                              {tx.toAddr ? truncateHash(tx.toAddr) : '—'}
                            </span>
                          </div>
                          <div>
                            Value:{' '}
                            <span className="text-white">
                              <FormattedValueElement
                                formattedStr={tx.tokenTransferAmount
                                  ? (tx.tokenSymbol
                                      ? `${formatSupply(tx.tokenTransferAmount)} ${tx.tokenSymbol}`
                                      : formatSupply(tx.tokenTransferAmount))
                                  : formatValue(tx.value, tx.denom)}
                                tokenAddress={tx.contractAddress}
                              />
                            </span>
                          </div>
                        </div>
                      </div>
                    )})}
              </div>
            </div>
          </section>

          {/* Validators + Tokens + Dev tools */}
          <section className="mt-8 grid gap-6 xl:grid-cols-3">
            {/* Top Validators */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm text-white/55">Consensus Layer</div>
                  <h2 className="mt-1 text-2xl font-semibold">Top Validators</h2>
                </div>
                <a
                  href="https://validator.litho.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
                >
                  All validators
                </a>
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
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm text-white/55">Onchain Assets</div>
                  <h2 className="mt-1 text-2xl font-semibold">Top Assets</h2>
                </div>
                <Link
                  href="/tokens"
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50 transition"
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
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
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
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="font-medium">Bridge Activity</div>
                  <div className="mt-2 text-sm text-white/65">
                    Track wrapped assets, cross-chain messages, and bridge mint / burn flows.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA banner */}
          <section className="mt-8 rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-transparent to-violet-500/10 p-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="text-sm text-white/55">Developer Experience</div>
                <h2 className="mt-1 text-3xl font-semibold">
                  Build, verify, and explore Lithic contracts on Makalu.
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-white/65">
                  Connect wallet, inspect onchain activity, verify LEP100 contracts, monitor AI
                  requests, and track validator or bridge performance from a single explorer
                  interface.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://lithiclang.ai/verifier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-white/90 transition"
                >
                  Open Contract Verifier
                </a>
                <Link
                  href="/faucet"
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  Get Testnet LITHO
                </Link>
              </div>
            </div>
          </section>

      </div>
    </>
  );
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
