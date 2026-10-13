import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';
import { parseUnits, type Eip1193Provider } from 'ethers';
import Head from 'next/head';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import FeatureUnavailable from '@/components/FeatureUnavailable';
import {
  BRIDGE_CHAIN_LIST,
  BRIDGE_SOURCE_CHAINS,
  BRIDGE_TOKENS,
  approveIfNeeded,
  chainByKey,
  describeBridgeError,
  fetchSignatures,
  fetchStatus,
  lockTokens,
  releaseTokens,
  tokenAddressFor,
  type BridgeStatus,
} from '@/lib/bridge';
import { EXPLORER_TITLE } from '@/lib/constants';
import { NETWORK } from '@/lib/network';

const PRIMARY_CTA_CLASSES =
  'rounded-2xl border border-sky-300/20 bg-gradient-to-r from-[#1cc7ff] via-[#227dff] to-[#3157ff] px-5 py-3 text-sm font-medium text-white shadow-[0_18px_40px_rgba(37,99,235,0.35)] transition duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0';

// Wallet add/switch params — only the source (Lithosphere) chains need these,
// since the lock happens on the source chain. External destinations are reached
// by the bridge relayer, not the user's wallet.
const CHAIN_PARAMS: Record<number, {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}> = {
  700777: {
    chainId: '0x' + (700777).toString(16),
    chainName: 'Lithosphere Makalu',
    rpcUrls: ['https://rpc.litho.ai'],
    nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
    blockExplorerUrls: ['https://makalu.litho.ai'],
  },
  900523: {
    chainId: '0x' + (900523).toString(16),
    chainName: 'Lithosphere Kamet',
    rpcUrls: ['https://rpc-3.litho.ai'],
    nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
    blockExplorerUrls: ['https://kamet.litho.ai'],
  },
};

function BridgeContent() {
  const { open } = useWeb3Modal();
  const { isConnected } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();

  const [fromKey, setFromKey] = useState('makalu');
  const [toKey, setToKey] = useState('kamet');
  const [symbol, setSymbol] = useState(BRIDGE_TOKENS[0].symbol);
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'error' | 'success'>('info');
  const [bridgeTxHash, setBridgeTxHash] = useState('');
  const [transfer, setTransfer] = useState<BridgeStatus | null>(null);

  const source = chainByKey(fromKey)!;
  // Destinations = every chain except the chosen source.
  const destOptions = useMemo(() => BRIDGE_CHAIN_LIST.filter((c) => c.key !== fromKey), [fromKey]);
  const dest = chainByKey(toKey) ?? destOptions[0];
  const token = useMemo(
    () => BRIDGE_TOKENS.find((t) => t.symbol === symbol) ?? BRIDGE_TOKENS[0],
    [symbol],
  );

  // Keep the destination valid when the source changes (can't equal source,
  // can't be a coming-soon chain).
  useEffect(() => {
    const current = destOptions.find((c) => c.key === toKey);
    if (toKey === fromKey || !current || current.comingSoon) {
      setToKey(destOptions.find((c) => !c.comingSoon)?.key ?? 'kamet');
    }
  }, [fromKey, toKey, destOptions]);

  const sourceTokenAddr = tokenAddressFor(token, source.key);

  function show(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    setStatus(msg);
    setStatusType(type);
  }

  const ensureChain = useCallback(
    async (targetId: number) => {
      if (!walletProvider) throw new Error('Wallet not connected');
      const params = CHAIN_PARAMS[targetId];
      if (!params) throw new Error(`No wallet config for chain ${targetId}`);
      const provider = walletProvider as Eip1193Provider;

      // The wallet's real chain, straight from the provider — the hook's
      // chainId can lag, and a "successful" switch prompt does not guarantee
      // the wallet actually landed on the target chain (seen live: MetaMask
      // stayed on Makalu while the flow proceeded to approve a Kamet token).
      const actualChain = async () =>
        Number(await provider.request({ method: 'eth_chainId' }));

      if ((await actualChain()) === targetId) return;
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
      } catch (err: unknown) {
        // MetaMask signals "unknown chain" as 4902, but sometimes wraps it in
        // a -32603 internal error — attempt the add on any failure and let the
        // verification below be the arbiter.
        await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
      }
      // Hard gate: never proceed to approve/lock until the wallet is really
      // on the target chain (some wallets apply the switch asynchronously).
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await actualChain()) === targetId) return;
        await new Promise((r) => setTimeout(r, 700));
      }
      throw new Error(
        `Wallet is still on chain ${await actualChain()}, not ${params.chainName} (${targetId}). ` +
        `Switch manually in the wallet — network RPC must be ${params.rpcUrls[0]} — then retry.`,
      );
    },
    [walletProvider],
  );

  useEffect(() => {
    if (!bridgeTxHash) return;
    let cancelled = false;
    const tick = async () => {
      const s = await fetchStatus(bridgeTxHash);
      if (cancelled || !s) return;
      setTransfer(s);
      if (s.status === 'completed') {
        show(`Bridge transfer completed — tokens released on ${dest.name}.`, 'success');
      }
    };
    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bridgeTxHash, dest.name]);

  async function handleLock() {
    if (!isConnected || !walletProvider) {
      void open({ view: 'Connect' });
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      show('Enter a valid amount.', 'error');
      return;
    }
    if (dest.comingSoon) {
      show(`${dest.name} is not routable yet — locked funds would strand. Pick another destination.`, 'error');
      return;
    }
    setBusy(true);
    setTransfer(null);
    setBridgeTxHash('');
    try {
      show(`Switching wallet to ${source.name}…`);
      await ensureChain(source.chainId);

      show('Approving bridge allowance…');
      await approveIfNeeded(
        walletProvider as Eip1193Provider,
        sourceTokenAddr,
        source.bridge,
        parseUnits(amount, token.decimals),
      );

      show(`Locking ${amount} ${token.symbol} on ${source.name}…`);
      const { bridgeTxHash: h } = await lockTokens(
        walletProvider as Eip1193Provider,
        source.bridge,
        sourceTokenAddr,
        amount,
        token.decimals,
        dest.chainId,
      );
      setBridgeTxHash(h);
      show(
        dest.litho
          ? `Locked. Validators are signing; it will be released on ${dest.name} automatically, or you can claim it below.`
          : `Locked. Validators are signing; the relayer will release the wrapped ${token.symbol} on ${dest.name}. Track status below.`,
        'success',
      );
    } catch (err: unknown) {
      show(describeBridgeError(err, { symbol: token.symbol, chainName: source.name }), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim() {
    if (!transfer || !walletProvider || !dest.litho) return;
    setBusy(true);
    try {
      show(`Switching wallet to ${dest.name} to claim…`);
      await ensureChain(dest.chainId);
      const sigs = await fetchSignatures(bridgeTxHash);
      show('Submitting release transaction…');
      const txHash = await releaseTokens(walletProvider as Eip1193Provider, dest.bridge, transfer, sigs);
      show(`Release submitted: ${txHash}`, 'success');
    } catch (err: unknown) {
      show(describeBridgeError(err, { symbol: token.symbol, chainName: dest.name }), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Manual claim is only offered for Lithosphere destinations (Makalu/Kamet),
  // where the wallet can switch to the dest chain and submit releaseTokens.
  // External chains are released by the relayer.
  const canClaim =
    dest.litho &&
    transfer &&
    transfer.status !== 'completed' &&
    !transfer.releaseTxHash &&
    transfer.signaturesCollected >= transfer.signaturesRequired;

  const statusColors = {
    info: 'border-blue-400/20 bg-blue-400/10 text-blue-200',
    error: 'border-red-400/20 bg-red-400/10 text-red-200',
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  };

  const selectCls =
    'w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/50';

  return (
    <>
      <Head>
        <title>Bridge | {EXPLORER_TITLE}</title>
      </Head>
      <div className="text-white">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              MultX Bridge
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">Cross-chain bridge</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-white/70">
              Bridge LEP-100 assets from Lithosphere Makalu or Kamet to other chains — Ethereum
              Sepolia, Base Sepolia, and BNB testnet. Lock on the source chain; tokens are released
              on the destination after validators sign.
            </p>
          </div>

          {status && (
            <div className={`mb-6 rounded-2xl border p-4 text-sm ${statusColors[statusType]}`}>{status}</div>
          )}

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-white/70">From</label>
                <select value={fromKey} onChange={(e) => setFromKey(e.target.value)} className={selectCls}>
                  {BRIDGE_SOURCE_CHAINS.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/70">To</label>
                <select value={dest.key} onChange={(e) => setToKey(e.target.value)} className={selectCls}>
                  {destOptions.map((c) => (
                    <option key={c.key} value={c.key} disabled={c.comingSoon} className={c.comingSoon ? 'text-white/30' : undefined}>
                      {c.name}{c.comingSoon ? ' — coming soon' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-white/70">Token</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={selectCls}>
                  {BRIDGE_TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol} — {t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/70">Amount</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-400/50"
                />
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/65">
              Source: <span className="text-white">{source.name}</span> → Destination:{' '}
              <span className="text-white">{dest.name}</span>
            </div>

            {!dest.litho && (
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs leading-5 text-amber-200/90">
                External-chain routes ({dest.name}) are in testnet validation. The lock executes on{' '}
                {source.name} immediately; the relayer releases the wrapped {token.symbol} on {dest.name}{' '}
                once validators sign — completion depends on relayer funding + wrapped-token registration
                on the destination.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={handleLock} disabled={busy} className={PRIMARY_CTA_CLASSES}>
                {busy ? 'Working…' : isConnected ? `Bridge ${token.symbol}` : 'Connect Wallet'}
              </button>
              {canClaim && (
                <button onClick={handleClaim} disabled={busy} className={PRIMARY_CTA_CLASSES}>
                  Claim on {dest.name}
                </button>
              )}
            </div>

            {transfer && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/75">
                <div className="mb-2 font-medium text-white">Transfer status</div>
                <div className="grid gap-1">
                  <div>Status: <span className="text-white">{transfer.status}</span></div>
                  <div>Signatures: {transfer.signaturesCollected}/{transfer.signaturesRequired}</div>
                  {transfer.releaseTxHash && (
                    <div className="break-all">Release tx: {transfer.releaseTxHash}</div>
                  )}
                  <div className="break-all text-white/50">Bridge hash: {bridgeTxHash}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function EnabledBridgePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return <BridgeContent />;
}

export default function BridgePage() {
  return <FeatureUnavailable feature="Bridge" />;
}
