import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  useWeb3ModalAccount,
  useWeb3ModalProvider,
  useDisconnect,
} from '@web3modal/ethers/react';

const MAKALU_CHAIN_ID = 700777;
const MAKALU_CHAIN_HEX = '0xab169';

const MAKALU_CHAIN_FOR_WALLET = {
  chainId: MAKALU_CHAIN_HEX,
  chainName: 'Lithosphere Makalu Testnet',
  rpcUrls: ['https://rpc.litho.ai'],
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  blockExplorerUrls: ['https://makalu.litho.ai'],
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * NetworkSwitchModal
 *
 * Renders a portal modal whenever the connected wallet is on a chain other
 * than Lithosphere Makalu Testnet (chainId 700777).
 *
 * - If the chain is already in the wallet → prompts to switch.
 * - If the chain is missing (error 4902) → prompts to add + switch.
 * - Dismissing (X) hides the modal for the current session; it reappears
 *   if the user switches away from Makalu again or reconnects.
 */
export default function NetworkSwitchModal() {
  const { address, isConnected, chainId } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const { disconnect } = useDisconnect();

  const [dismissed, setDismissed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset dismissed state when the user disconnects or lands on Makalu
  useEffect(() => {
    if (!isConnected || chainId === MAKALU_CHAIN_ID) {
      setDismissed(false);
    }
  }, [isConnected, chainId]);

  const shouldShow =
    mounted &&
    isConnected &&
    Boolean(address) &&
    chainId !== MAKALU_CHAIN_ID &&
    !dismissed;

  const handleSwitch = useCallback(async () => {
    const injected =
      typeof window !== 'undefined'
        ? (window as Window & { ethereum?: EthereumProvider }).ethereum
        : undefined;
    const provider =
      (walletProvider as EthereumProvider | undefined) ?? injected;
    if (!provider?.request) return;

    setSwitching(true);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: MAKALU_CHAIN_HEX }],
      });
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? Number((err as { code?: number | string }).code)
          : undefined;
      const message =
        err instanceof Error ? err.message : String(err ?? '');
      const chainMissing =
        code === 4902 || /4902|unrecognized chain|not been added/i.test(message);

      if (chainMissing) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [MAKALU_CHAIN_FOR_WALLET],
          });
        } catch (addErr: unknown) {
          const addCode =
            typeof addErr === 'object' &&
            addErr !== null &&
            'code' in addErr
              ? Number((addErr as { code?: number | string }).code)
              : undefined;
          if (addCode !== 4001) {
            console.error('Failed to add Makalu network:', addErr);
          }
        }
      } else if (code !== 4001) {
        console.error('Failed to switch to Makalu network:', err);
      }
    } finally {
      setSwitching(false);
    }
  }, [walletProvider]);

  const handleDisconnect = useCallback(async () => {
    setDismissed(false);
    await disconnect();
  }, [disconnect]);

  if (!shouldShow || typeof document === 'undefined') return null;

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={() => setDismissed(true)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-switch-title"
        className="w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0f16] shadow-2xl shadow-black/80"
        style={{ animation: 'networkModalIn 200ms ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-1">
          <h2
            id="network-switch-title"
            className="text-[17px] font-bold tracking-tight text-white"
          >
            Switch Network
          </h2>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Close network switch dialog"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-6 pb-6">
          <p className="mt-3 text-center text-sm leading-6 text-white/55">
            This app doesn&apos;t support your current network.
            <br />
            Switch to an available option to continue.
          </p>

          {/* Network Option */}
          <button
            type="button"
            onClick={handleSwitch}
            disabled={switching}
            className="mt-6 flex w-full items-center gap-4 rounded-2xl bg-white/[0.05] px-4 py-3.5 text-left transition hover:bg-white/[0.10] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {/* Network icon */}
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1a2030]">
              <svg
                className="h-5 w-5 text-white/80"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {/* Hub / network icon */}
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="5" cy="19" r="1.5" />
                <circle cx="19" cy="19" r="1.5" />
                <line x1="12" y1="6.5" x2="5" y2="17.5" />
                <line x1="12" y1="6.5" x2="19" y2="17.5" />
                <line x1="6.5" y1="19" x2="17.5" y2="19" />
              </svg>
            </span>

            <span className="flex-1 font-semibold text-[15px] text-white">
              Lithosphere Makalu Testnet
            </span>

            {switching ? (
              <span className="text-xs text-white/40 animate-pulse">
                Switching…
              </span>
            ) : (
              <svg
                className="h-4 w-4 text-white/30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 18l6-6-6-6"
                />
              </svg>
            )}
          </button>

          {/* ── Separator ── */}
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-white/35">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* Disconnect */}
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex w-full items-center gap-4 rounded-2xl bg-white/[0.03] px-4 py-3.5 text-left transition hover:bg-white/[0.07] active:scale-[0.99]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1a2030]">
              <svg
                className="h-5 w-5 text-white/55"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 16l4-4m0 0l-4-4m4 4H7" />
                <path d="M9 20H5a2 2 0 01-2-2V6a2 2 0 012-2h4" />
              </svg>
            </span>
            <span className="font-semibold text-[15px] text-white/65">
              Disconnect
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
