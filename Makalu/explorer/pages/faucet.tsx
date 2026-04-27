import Head from 'next/head';
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';
import { EXPLORER_TITLE } from '@/lib/constants';
import { isEvmAddress } from '@/lib/format';
import { isEvmTxHash } from '@/lib/tx';

type SelectOption = {
  value: string;
  label: string;
};

type ClaimResponse = {
  ok: boolean;
  txHash?: string;
  message?: string;
  cooldownSeconds?: number;
  assetId?: string | null;
};

type FaucetAssetConfig = {
  id: string;
  name: string;
  symbol: string;
  kind: 'native' | 'erc20';
  standard?: string;
  allowedAmounts: string[];
  defaultAmount: string;
  contractAddress?: string | null;
};

type FaucetInfoResponse = {
  ok?: boolean;
  assets?: FaucetAssetConfig[];
  defaultAssetId?: string;
  cooldownHours?: number;
};

const NETWORK = {
  networkName: 'Lithosphere Makalu Testnet',
  rpcUrl: 'https://rpc.litho.ai',
  evmRpcUrl: 'https://rpc.litho.ai',
  cosmosChainId: 'lithosphere_700777-2',
  evmChainIdDecimal: 700777,
  evmChainIdHex: '0xab169',
  explorer: 'https://makalu.litho.ai',
  symbol: 'LITHO',
  decimals: 18,
};

const MAKALU_CHAIN = {
  chainId: '0xab169',
  chainName: 'Lithosphere Makalu Testnet',
  rpcUrls: ['https://rpc.litho.ai'],
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  blockExplorerUrls: ['https://makalu.litho.ai'],
};

const MAKALU_CHAIN_ID = parseInt(MAKALU_CHAIN.chainId, 16); // 700777

const FALLBACK_ASSETS: FaucetAssetConfig[] = [
  {
    id: 'litho',
    name: 'Lithosphere',
    symbol: 'LITHO',
    kind: 'native',
    standard: 'native',
    allowedAmounts: ['1', '2', '5'],
    defaultAmount: '1',
  },
];

const PRIMARY_CTA_CLASSES =
  'rounded-2xl border border-sky-300/20 bg-gradient-to-r from-[#1cc7ff] via-[#227dff] to-[#3157ff] px-5 py-3 text-sm font-medium text-white shadow-[0_18px_40px_rgba(37,99,235,0.35)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_54px_rgba(34,197,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0';

function shortenAddress(value: string) {
  if (!value) return '';
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeFaucetAssets(assets?: FaucetAssetConfig[] | null): FaucetAssetConfig[] {
  if (!Array.isArray(assets) || assets.length === 0) {
    return FALLBACK_ASSETS;
  }

  return assets
    .map((asset) => {
      const symbol = typeof asset.symbol === 'string' && asset.symbol
        ? asset.symbol
        : 'TOKEN';
      const allowedAmounts = Array.isArray(asset.allowedAmounts) && asset.allowedAmounts.length > 0
        ? asset.allowedAmounts.map((value) => String(value))
        : (asset.kind === 'native' ? ['1', '2', '5'] : ['10', '25', '50']);
      const defaultAmount =
        typeof asset.defaultAmount === 'string' && allowedAmounts.includes(asset.defaultAmount)
          ? asset.defaultAmount
          : allowedAmounts[0];

      return {
        id: asset.id || symbol.toLowerCase(),
        name: asset.name || symbol,
        symbol,
        kind: asset.kind === 'erc20' ? 'erc20' : 'native',
        standard: asset.standard || (asset.kind === 'erc20' ? 'LEP-100' : 'native'),
        allowedAmounts,
        defaultAmount,
        contractAddress: asset.contractAddress ?? null,
      } as FaucetAssetConfig;
    })
    .filter((asset) => Boolean(asset.id && asset.symbol));
}

function ThemedSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const selected = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative" title={title}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-left text-sm text-white outline-none transition hover:border-white/20 focus:border-sky-400/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? value}</span>
        <svg
          className={`pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/60 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-sky-400/25 bg-[#071120] shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-4 py-3 text-sm transition ${
                  isSelected
                    ? 'bg-blue-500/20 text-blue-100'
                    : 'text-white/85 hover:bg-white/10'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <span className="text-xs text-sky-300">Selected</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// All web3modal hooks live here — this component only renders client-side.
function FaucetContent() {
  const { open } = useWeb3Modal();
  const { address: walletAddress, isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const [address, setAddress] = useState('');
  const [assets, setAssets] = useState<FaucetAssetConfig[]>(FALLBACK_ASSETS);
  const [assetId, setAssetId] = useState(FALLBACK_ASSETS[0].id);
  const [amount, setAmount] = useState(FALLBACK_ASSETS[0].defaultAmount);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error' | 'success'>('info');
  const [txHash, setTxHash] = useState<string>('');
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [cooldownHours, setCooldownHours] = useState(24);
  const [mounted, setMounted] = useState(false);
  const [isAddingNetwork, setIsAddingNetwork] = useState(false);
  const pendingNetworkAdd = useRef(false);

  const selectedAsset = useMemo(() => {
    return assets.find((asset) => asset.id === assetId) ?? assets[0] ?? FALLBACK_ASSETS[0];
  }, [assetId, assets]);

  const assetOptions = useMemo<SelectOption[]>(() => {
    return assets.map((asset) => ({
      value: asset.id,
      label: asset.kind === 'native'
        ? `${asset.symbol} (Native)`
        : `${asset.symbol} (${asset.standard ?? 'LEP-100'})`,
    }));
  }, [assets]);

  const amountOptions = useMemo<SelectOption[]>(() => {
    return selectedAsset.allowedAmounts.map((value) => ({
      value,
      label: `${value} ${selectedAsset.symbol}`,
    }));
  }, [selectedAsset]);

  const normalizedAddress = address.trim();
  const isValidRecipientAddress = isEvmAddress(normalizedAddress);
  const amountIsValid = selectedAsset.allowedAmounts.includes(amount);
  const canSubmitClaim = isValidRecipientAddress && amountIsValid && !claiming;
  const addressHelpText = normalizedAddress
    ? (
      isValidRecipientAddress
        ? 'Faucet claims are sent to the EVM address shown above.'
        : 'The faucet only supports EVM recipient addresses in 0x... format.'
    )
    : 'Paste a 0x recipient address or connect a Web3 wallet to autofill it.';

  // Sync Web3Modal connection state
  useEffect(() => {
    setMounted(true);
    if (isConnected && walletAddress) {
      setConnectedAddress(walletAddress);
      setAddress((current) => current.trim() || walletAddress);
      return;
    }
    setConnectedAddress(null);
  }, [isConnected, walletAddress]);

  useEffect(() => {
    let cancelled = false;

    async function loadFaucetInfo() {
      try {
        const response = await fetch('/api/faucet/info');
        const payload = await response.json() as FaucetInfoResponse;
        if (!response.ok) {
          return;
        }

        const nextAssets = normalizeFaucetAssets(payload.assets);
        if (cancelled || nextAssets.length === 0) {
          return;
        }

        const nextAssetId =
          typeof payload.defaultAssetId === 'string' &&
          nextAssets.some((asset) => asset.id === payload.defaultAssetId)
            ? payload.defaultAssetId
            : nextAssets[0].id;
        const nextAsset = nextAssets.find((asset) => asset.id === nextAssetId) ?? nextAssets[0];

        setAssets(nextAssets);
        setAssetId(nextAsset.id);
        setAmount(nextAsset.defaultAmount);
        setCooldownHours(payload.cooldownHours ?? 24);
      } catch {
        // Keep the fallback config when faucet metadata is unavailable.
      }
    }

    void loadFaucetInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedAsset.allowedAmounts.includes(amount)) {
      setAmount(selectedAsset.defaultAmount);
    }
  }, [amount, selectedAsset]);

  // After wallet connects, auto-add Makalu network if user had clicked the button
  useEffect(() => {
    if (isConnected && pendingNetworkAdd.current) {
      pendingNetworkAdd.current = false;
      promptNetworkAdd();
    }
  }, [isConnected]);

  async function promptNetworkAdd() {
    const provider = walletProvider ?? (window.ethereum as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined);
    if (!provider) return;
    if (Number(chainId) === MAKALU_CHAIN_ID) return;
    setIsAddingNetwork(true);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: MAKALU_CHAIN.chainId }],
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
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

  async function addOrSwitchMakalu() {
    if (Number(chainId) === MAKALU_CHAIN_ID) return;

    if (!isConnected) {
      pendingNetworkAdd.current = true;
      await open({ view: 'Connect' });
      return;
    }

    await promptNetworkAdd();
  }

  const explorerTxUrl = useMemo(() => {
    if (!isEvmTxHash(txHash)) return '';
    return `${NETWORK.explorer}/txs/${txHash}`;
  }, [txHash]);

  function showStatus(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    setStatus(msg);
    setStatusType(type);
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    showStatus('');
    setTxHash('');
    setCooldown(null);

    if (!isValidRecipientAddress) {
      showStatus('The faucet currently supports EVM (0x) addresses only. Please use your 0x address.', 'error');
      return;
    }

    if (!amountIsValid) {
      showStatus(`Select one of the allowed ${selectedAsset.symbol} amounts before submitting your claim.`, 'error');
      return;
    }

    setClaiming(true);

    try {
      const res = await fetch('/api/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: normalizedAddress,
          assetId: selectedAsset.id,
          amount,
        }),
      });

      let data: ClaimResponse;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        // If it's not JSON, it's likely a 502 Bad Gateway from Next.js proxy when backend is down
        throw new Error(res.status >= 500 ? 'Faucet service is currently offline. Please try again later.' : 'Unexpected response from faucet service.');
      }

      if (!res.ok || !data.ok) {
        showStatus(data.message || 'Faucet claim failed.', 'error');
        if (typeof data.cooldownSeconds === 'number') {
           setCooldown(data.cooldownSeconds);
        }
        return;
      }

      showStatus(data.message || 'Claim submitted successfully.', 'success');
      if (isEvmTxHash(data.txHash)) setTxHash(data.txHash);
      if (typeof data.cooldownSeconds === 'number') setCooldown(data.cooldownSeconds);
    } catch (err: any) {
      showStatus(err?.message || 'Failed to submit faucet claim.', 'error');
    } finally {
      setClaiming(false);
    }
  }

  const statusColors = {
    info: 'border-blue-400/20 bg-blue-400/10 text-blue-200',
    error: 'border-red-400/20 bg-red-400/10 text-red-200',
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  };

  if (!mounted) {
    return null;
  }

  return (
    <>
      <Head>
        <title>Faucet | {EXPLORER_TITLE}</title>
      </Head>

      <div className="text-white">
        <div className="mx-auto max-w-6xl">

          {/* Status banner — visible at top so feedback is always seen */}
          {status && (
            <div className={`mb-6 rounded-2xl border p-4 text-sm ${statusColors[statusType]}`}>
              {status}
            </div>
          )}

          {/* Hero */}
          <div className="mb-10 grid gap-6 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                Lithosphere Testnet
              </div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Claim testnet assets on Makalu
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/70">
                Connect your wallet, switch to Lithosphere Makalu Testnet, and request the enabled
                faucet assets for app development, contract deployment, and network testing.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (isConnected) {
                      window.dispatchEvent(new CustomEvent('open-wallet-menu'));
                    } else {
                      void open({ view: 'Connect' });
                    }
                  }}
                  className={PRIMARY_CTA_CLASSES}
                >
                  {isConnected && connectedAddress
                    ? `Connected: ${shortenAddress(connectedAddress)}`
                    : 'Connect Wallet'}
                </button>
              </div>
            </div>

            {/* Network summary card */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30">
              <div className="mb-4 text-sm font-medium text-white/80">Makalu network summary</div>
              <div className="grid gap-3 text-sm text-white/75">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">Network Name</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.networkName}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">RPC</div>
                  <div className="mt-1 break-all font-medium text-white">{NETWORK.evmRpcUrl}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/50">Cosmos Chain ID</div>
                    <div className="mt-1 font-medium text-white">{NETWORK.cosmosChainId}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/50">EVM Chain ID</div>
                    <div className="mt-1 font-medium text-white">{NETWORK.evmChainIdDecimal}</div>
                  </div>
                </div>
                <a
                  href={NETWORK.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:bg-white/5"
                >
                  <div className="text-white/50">Explorer</div>
                  <div className="mt-1 font-medium text-white">Open Makalu Explorer</div>
                </a>
              </div>
            </div>
          </div>

          {/* Claim form + network setup */}
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-6">
                <div className="text-sm font-medium text-white/80">Faucet</div>
                <h2 className="mt-2 text-2xl font-semibold">Claim configured faucet assets</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Enter a 0x recipient address, choose an enabled asset, and pick one of its
                  allowed amounts. Claims are limited per wallet and asset.
                </p>
              </div>

              <form onSubmit={submitClaim} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-white/70">Recipient Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x... recipient address"
                    className={`w-full rounded-2xl border bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 ${
                      normalizedAddress && !isValidRecipientAddress
                        ? 'border-red-400/40 focus:border-red-300/60'
                        : 'border-white/10 focus:border-white/25'
                    }`}
                  />
                  <p className={`mt-2 text-xs ${normalizedAddress && !isValidRecipientAddress ? 'text-red-300' : 'text-white/45'}`}>
                    {addressHelpText}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-white/70">Asset</label>
                    <ThemedSelect
                      value={selectedAsset.id}
                      onChange={setAssetId}
                      options={assetOptions}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/70">Amount</label>
                    <ThemedSelect
                      value={amount}
                      onChange={setAmount}
                      options={amountOptions}
                    />
                    <p className={`mt-2 text-xs ${amountIsValid ? 'text-white/45' : 'text-red-300'}`}>
                      Allowed: {selectedAsset.allowedAmounts.join(', ')} {selectedAsset.symbol}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={!canSubmitClaim}
                    className={PRIMARY_CTA_CLASSES}
                  >
                    {claiming ? 'Submitting...' : `Claim Testnet ${selectedAsset.symbol}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isConnected) {
                        window.dispatchEvent(new CustomEvent('open-wallet-menu'));
                      } else {
                        void open({ view: 'Connect' });
                      }
                    }}
                    className={PRIMARY_CTA_CLASSES}
                  >
                    {isConnected && connectedAddress ? `${shortenAddress(connectedAddress)}` : 'Connect Wallet'}
                  </button>
                </div>
              </form>

              {txHash && (
                <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
                  <div className="font-medium">Transaction Submitted</div>
                  <a
                    href={explorerTxUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-white underline underline-offset-4"
                  >
                    {txHash}
                  </a>
                </div>
              )}

              {cooldown !== null && cooldown > 0 && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                  Cooldown: {Math.ceil(cooldown / 3600)}h remaining before the next {selectedAsset.symbol} claim
                </div>
              )}
            </section>

            {/* Network setup panel */}
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-6">
                <div className="text-sm font-medium text-white/80">Network Setup</div>
                <h2 className="mt-2 text-2xl font-semibold">Connect to Makalu testnet</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Add Lithosphere Makalu Testnet to your Web3 Wallet or use the chain identifiers for
                  native tooling.
                </p>
              </div>

              <div className="space-y-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">Network Name</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.networkName}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">RPC URL</div>
                  <div className="mt-1 break-all font-medium text-white">{NETWORK.evmRpcUrl}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">Cosmos Chain ID</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.cosmosChainId}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">EVM Chain ID</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.evmChainIdDecimal}</div>
                </div>
                <a
                  href={NETWORK.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:bg-white/5"
                >
                  <div className="text-white/50">Explorer</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.explorer}</div>
                </a>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={addOrSwitchMakalu}
                  disabled={isAddingNetwork || Number(chainId) === MAKALU_CHAIN_ID}
                  className={PRIMARY_CTA_CLASSES}
                >
                  {isAddingNetwork
                    ? 'Adding...'
                    : Number(chainId) === MAKALU_CHAIN_ID
                      ? 'Makalu Connected'
                      : isConnected
                        ? 'Switch to Makalu'
                        : 'Add Makalu Network'}
                </button>
                <a
                  href={NETWORK.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Open Explorer
                </a>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-medium text-white">Wallet support</div>
                <ul className="mt-3 space-y-2 text-sm text-white/65">
                  <li>• Desktop users: Use your browser wallet extension</li>
                  <li>• Mobile users: Use WalletConnect to scan the QR code with your mobile wallet</li>
                  <li>• Click &quot;Add Makalu Network&quot; to auto-add the chain to your wallet</li>
                  <li>• Faucet claims require an EVM recipient address in 0x... format</li>
                  <li>• Claim the enabled faucet assets once every {cooldownHours} hours</li>
                </ul>
              </div>
            </section>
          </div>

          {/* Informational sections */}
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {/* What You Can Do */}
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold mb-4">What You Can Do</h2>
              <ul className="space-y-3 text-sm text-white/75">
                <li className="flex gap-2"><span>🛠️</span><span>Run a validator node and participate in consensus</span></li>
                <li className="flex gap-2"><span>🔗</span><span>Deploy and test EVM smart contracts</span></li>
                <li className="flex gap-2"><span>💸</span><span>Interact with the network using test tokens</span></li>
                <li className="flex gap-2"><span>🧪</span><span>Stress-test infrastructure and dApps</span></li>
              </ul>
            </section>

            {/* Validator Participation */}
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold mb-4">Validator Participation</h2>
              <p className="text-sm text-white/75 mb-4">
                We invite node operators to join the network:
              </p>
              <ul className="space-y-2 text-sm text-white/75 mb-4">
                <li>• Set up a full node using the official binaries</li>
                <li>• Stake tokens to become a validator</li>
                <li>• Help secure and decentralize the network</li>
              </ul>
              <a
                href="https://github.com/lithoagent/litho-makalu-validators"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-white/10"
              >
                Validator Setup Guide &rarr;
              </a>
            </section>

            {/* Important Notes */}
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold mb-4">Important Notes</h2>
              <ul className="space-y-3 text-sm text-white/75">
                <li className="flex gap-2"><span>⚠️</span><span>This is a test environment — tokens have no monetary value</span></li>
                <li className="flex gap-2"><span>⚠️</span><span>Network parameters may change</span></li>
                <li className="flex gap-2"><span>⚠️</span><span>Expect upgrades, resets, and instability during testing</span></li>
              </ul>
            </section>
          </div>

        </div>
      </div>
    </>
  );
}

export default function FaucetPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <FaucetContent />;
}
