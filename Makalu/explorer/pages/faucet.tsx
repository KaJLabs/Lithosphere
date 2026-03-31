import Head from 'next/head';
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useWeb3Modal } from '@web3modal/ethers/react';
import { useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react';
import { EXPLORER_TITLE } from '@/lib/constants';

type WalletType = 'WEB3' | 'COSMOS';

type ClaimResponse = {
  ok: boolean;
  txHash?: string;
  message?: string;
  cooldownSeconds?: number;
};

const NETWORK = {
  networkName: 'Lithosphere Makalu',
  rpcUrl: 'https://rpc.litho.ai',
  evmRpcUrl: 'https://rpc.litho.ai',
  cosmosChainId: 'lithosphere_700777-1',
  evmChainIdDecimal: 700777,
  evmChainIdHex: '0xab169',
  explorer: 'https://makalu.litho.ai',
  symbol: 'LITHO',
  decimals: 18,
};

const MAKALU_CHAIN = {
  chainId: '0xab169',
  chainName: 'Lithosphere Makalu',
  rpcUrls: ['https://rpc.litho.ai'],
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  blockExplorerUrls: ['https://makalu.litho.ai'],
};

const MAKALU_CHAIN_ID = parseInt(MAKALU_CHAIN.chainId, 16); // 700777

function shortenAddress(value: string) {
  if (!value) return '';
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function FaucetPage() {
  const { open } = useWeb3Modal();
  const { address: walletAddress, isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const [address, setAddress] = useState('');
  const [walletType, setWalletType] = useState<WalletType>('COSMOS');
  const [amount, setAmount] = useState('10 LITHO');
  const [reason, setReason] = useState('');
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error' | 'success'>('info');
  const [txHash, setTxHash] = useState<string>('');
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isAddingNetwork, setIsAddingNetwork] = useState(false);
  const pendingNetworkAdd = useRef(false);

  // Sync Web3Modal connection state
  useEffect(() => {
    setMounted(true);
    if (isConnected && walletAddress) {
      setConnectedAddress(walletAddress);
      setAddress(walletAddress);
      setWalletType('WEB3');
    }
  }, [isConnected, walletAddress]);

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
    if (chainId === MAKALU_CHAIN_ID) return;
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
    if (chainId === MAKALU_CHAIN_ID) return;
    if (!isConnected) {
      pendingNetworkAdd.current = true;
      await open({ view: 'Connect' });
      return;
    }
    await promptNetworkAdd();
  }

  const explorerTxUrl = useMemo(() => {
    if (!txHash) return '';
    return `${NETWORK.explorer}/tx/${txHash}`;
  }, [txHash]);

  function showStatus(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    setStatus(msg);
    setStatusType(type);
  }

  async function signOwnershipProof(): Promise<string> {
    // Web3Modal with ethers can handle signing
    // For now, return empty string as the backend can work without it
    return '';
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    showStatus('');
    setTxHash('');
    setCooldown(null);
    setClaiming(true);

    try {
      let signature = '';
      if (
        walletType === 'WEB3' &&
        connectedAddress &&
        connectedAddress.toLowerCase() === address.toLowerCase()
      ) {
        try {
          signature = await signOwnershipProof();
        } catch {
          // continue without signature if user rejects
        }
      }

      const res = await fetch('/api/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, walletType, amount, reason, signature }),
      });

      const data: ClaimResponse = await res.json();

      if (!res.ok || !data.ok) {
        showStatus(data.message || 'Faucet claim failed.', 'error');
        if (typeof data.cooldownSeconds === 'number') {
          setCooldown(data.cooldownSeconds);
        }
        return;
      }

      showStatus(data.message || 'Claim submitted successfully.', 'success');
      if (data.txHash) setTxHash(data.txHash);
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
                Claim LITHO testnet coins on Makalu
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/70">
                Connect your wallet, switch to Lithosphere Makalu, and request LITHO for app
                development, contract deployment, and network testing.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => open()}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90"
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
                    <div className="text-white/50">Chain ID</div>
                    <div className="mt-1 font-medium text-white">{NETWORK.cosmosChainId}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/50">Chain ID</div>
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
                <h2 className="mt-2 text-2xl font-semibold">Claim LITHO testnet coins</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Enter your wallet address and select an amount. Maximum one claim per wallet every 24 hours.
                </p>
              </div>

              <form onSubmit={submitClaim} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-white/70">Wallet Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x... or litho1... wallet address"
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-white/70">Wallet Type</label>
                    <select
                      value={walletType}
                      onChange={(e) => setWalletType(e.target.value as WalletType)}
                      className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-white/25"
                    >
                      <option value="COSMOS">Wallet</option>
                      <option value="EVM">Web3 Wallet</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/70">Amount</label>
                    <select
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-white/25"
                    >
                      <option>10 LITHO</option>
                      <option>25 LITHO</option>
                      <option>50 LITHO</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={claiming || !address}
                    className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {claiming ? 'Submitting...' : 'Claim Testnet LITHO'}
                  </button>
                  <button
                    type="button"
                    onClick={() => open()}
                    className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
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
                  Cooldown: {Math.ceil(cooldown / 3600)}h remaining before next claim
                </div>
              )}
            </section>

            {/* Network setup panel */}
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="mb-6">
                <div className="text-sm font-medium text-white/80">Network Setup</div>
                <h2 className="mt-2 text-2xl font-semibold">Connect to Makalu testnet</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Add Lithosphere Makalu to your Web3 Wallet or use the chain identifiers for
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
                  <div className="text-white/50">Chain ID</div>
                  <div className="mt-1 font-medium text-white">{NETWORK.cosmosChainId}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-white/50">Chain ID</div>
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
                  disabled={isAddingNetwork || chainId === MAKALU_CHAIN_ID}
                  className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isAddingNetwork
                    ? 'Adding...'
                    : chainId === MAKALU_CHAIN_ID
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
                  <li>• One claim per wallet every 24 hours</li>
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
