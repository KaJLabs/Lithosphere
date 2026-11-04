import { useWeb3Modal, useWeb3ModalProvider } from '@web3modal/ethers/react';
import { BrowserProvider } from 'ethers';
import { useState } from 'react';
import { NETWORK } from '@/lib/network';
import type { ApiTokenDetail } from '@/lib/types';

export function VerifiedTokenBadge({ verified }: { verified?: boolean }) {
  return verified ? <span className="ml-2 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-[var(--color-text-primary)]"
    title="Contract source and deployer wallet ownership verified.">✓ Verified</span> : null;
}

export default function TokenVerification({ token, onVerified }: { token: ApiTokenDetail; onVerified: () => void }) {
  const { open } = useWeb3Modal();
  const { walletProvider } = useWeb3ModalProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (token.type === 'native') return null;
  async function verify() {
    setError(null);
    if (!walletProvider) { await open(); return; }
    setBusy(true);
    try {
      const provider = new BrowserProvider(walletProvider);
      if (Number((await provider.getNetwork()).chainId) !== NETWORK.evmChainId) {
        throw new Error(`Switch your wallet to ${NETWORK.label} first.`);
      }
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      if (!token.creator || token.creator.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connect the wallet that deployed this contract.');
      }
      const nonceResponse = await fetch(`/api/auth/nonce?address=${address}`);
      if (!nonceResponse.ok) throw new Error('Could not start wallet verification.');
      const nonce = await nonceResponse.text();
      const message = [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        address, '', `Verify deployer ownership for ${token.address}.`, '',
        `URI: ${window.location.origin}`, 'Version: 1', `Chain ID: ${NETWORK.evmChainId}`,
        `Nonce: ${nonce}`, `Issued At: ${new Date().toISOString()}`,
      ].join('\n');
      const signature = await signer.signMessage(message);
      const sessionResponse = await fetch('/api/auth/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, address }),
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok || !session.sessionToken) throw new Error(session.error || 'Wallet verification failed.');
      const response = await fetch(`/api/tokens/${encodeURIComponent(token.address)}/verify-deployer`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Deployer verification failed.');
      onVerified();
    } catch (err) { setError(err instanceof Error ? err.message : 'Verification failed.'); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 rounded-2xl border border-[var(--color-border)] p-4 text-sm">
    <div className="font-medium">Token verification <VerifiedTokenBadge verified={token.verifiedBadge} /></div>
    <p className="mt-2 text-[var(--color-text-secondary)]">
      {token.deployerVerified ? 'Deployer wallet ownership verified.' : 'The deployer can prove wallet ownership with a signature.'}
      {' '}{token.verified ? 'Contract source verified.' : 'Contract source verification is also required for a verified badge.'}
    </p>
    {!token.deployerVerified && token.creator && <button disabled={busy} onClick={verify}
      className="mt-3 rounded-xl border border-[var(--color-border)] px-4 py-2 font-medium disabled:opacity-50">
      {busy ? 'Verifying…' : 'Verify deployer wallet'}
    </button>}
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
  </div>;
}
