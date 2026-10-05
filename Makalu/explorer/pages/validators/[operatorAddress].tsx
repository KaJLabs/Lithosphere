import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';

import CopyButton from '@/components/CopyButton';
import ErrorState from '@/components/ErrorState';
import ValidatorBadge from '@/components/ValidatorBadge';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { NETWORK } from '@/lib/network';
import type { ApiValidatorDetail } from '@/lib/types';
import { validatorProfile } from '@/lib/validator-profiles';

function formatTokens(raw: string) {
  const baseUnits = Number(raw);
  if (!Number.isFinite(baseUnits)) return '0';
  return (baseUnits / 1e18).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTokensPerShare(tokens: string, shares: string): string {
  const tokenAmount = Number(tokens);
  const shareAmount = Number(shares);
  if (!Number.isFinite(tokenAmount) || !Number.isFinite(shareAmount) || shareAmount <= 0) {
    return '—';
  }
  return (tokenAmount / shareAmount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export default function ValidatorDetailPage() {
  const router = useRouter();
  const operatorAddress = typeof router.query.operatorAddress === 'string'
    ? router.query.operatorAddress
    : null;
  const { data: chainData, loading, error, refetch } = useApi<ApiValidatorDetail>(
    operatorAddress ? `/validators/${encodeURIComponent(operatorAddress)}` : null
  );

  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (loading || !chainData) {
    return <div className="card p-8 text-center text-[var(--color-text-muted)]">Loading validator...</div>;
  }

  const profile = validatorProfile(chainData.address, NETWORK.isMainnet);
  const data = {
    ...chainData,
    moniker: profile?.name ?? chainData.moniker,
    // Rollout operators have no approved branding yet.
    profileImageUrl: profile ? null : chainData.profileImageUrl,
  };

  // API decimals can be serialized as JSON strings by PostgreSQL. Normalize at
  // the render boundary so an older API deployment cannot crash this page.
  const uptimePercentage = finiteNumberOrNull(data.uptimePercentage);
  const votingPowerPercentage = finiteNumberOrNull(data.votingPowerPercentage) ?? 0;

  return (
    <>
      <Head><title>{`${data.moniker} | ${EXPLORER_TITLE}`}</title></Head>
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-6">
        <Link href="/" className="hover:text-litho-400">Home</Link><span>/</span>
        <Link href="/validators" className="hover:text-litho-400">Validators</Link><span>/</span>
        <span className="truncate">{data.moniker}</span>
      </div>

      <section className="card p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <ValidatorAvatar name={data.moniker} src={data.profileImageUrl} />
            <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{data.moniker}</h1>
              <ValidatorBadge validator={data} />
              <span className={data.status === 'Bonded' && !data.jailed ? 'badge-success' : 'badge-warning'}>
                {data.jailed ? 'Jailed' : data.status}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <code className="break-all">{data.address}</code>
              <CopyButton text={data.address} />
            </div>
            {data.details && <p className="mt-3 max-w-2xl text-sm text-[var(--color-text-secondary)]">{data.details}</p>}
            </div>
          </div>
          <div className="text-left md:text-right">
            <div className="text-sm text-[var(--color-text-muted)]">Voting Power · Rank #{data.rank || '—'}</div>
            <div className="text-2xl font-bold">{data.votingPower} LITHO</div>
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{votingPowerPercentage.toFixed(2)}% of active voting power</div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Commission" value={data.commission} />
        <Stat label="Max Commission" value={data.commissionMaxRate} />
        <Stat label="Minimum Self Delegation" value={`${formatTokens(data.minSelfDelegation)} LITHO`} />
        <Stat label="Uptime" value={uptimePercentage == null ? '—' : `${uptimePercentage.toFixed(2)}%`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="text-lg font-semibold">Signing health</h2><p className="text-sm text-[var(--color-text-muted)]">Current on-chain signing window</p></div>
            <div className="text-2xl font-bold text-emerald-500">{uptimePercentage == null ? '—' : `${uptimePercentage.toFixed(2)}%`}</div>
          </div>
          <HealthGauge value={uptimePercentage} />
          <div className="mt-4 text-center text-xs text-[var(--color-text-muted)]">Calculated from the validator&apos;s real missed-block counter, not an estimated history.</div>
        </section>
        <section className="card p-6">
          <h2 className="text-lg font-semibold">Reliability signals</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Signal label="Missed blocks" value={data.missedBlocks ?? '—'} />
            <Signal label="Jailed" value={data.jailed ? 'Yes' : 'No'} tone={data.jailed ? 'text-red-500' : 'text-emerald-500'} />
            <Signal label="Voting power" value={`${data.votingPower} LITHO`} />
            <Signal label="Last indexed" value={data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : '—'} />
          </div>
        </section>
      </div>

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Delegation</h2>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">Current on-chain staking values for this validator.</p>
        <div className="grid gap-x-8 md:grid-cols-2">
          <Detail label="Total Delegated" value={`${formatTokens(data.tokens)} LITHO`} />
          <Detail label="Delegator Shares" value={formatTokens(data.delegatorShares)} />
          <Detail label="Tokens per Share" value={formatTokensPerShare(data.tokens, data.delegatorShares)} />
          <Detail label="Minimum Self Delegation" value={`${formatTokens(data.minSelfDelegation)} LITHO`} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Validator Information</h2>
        <div className="grid gap-x-8 md:grid-cols-2">
          <Detail label="Operator Address" value={data.address} mono copy />
          <Detail label="Consensus Address" value={data.consensusAddress} mono copy />
          <Detail label="Max Commission Change" value={data.commissionMaxChange} />
          <Detail label="Missed Blocks" value={data.missedBlocks ?? '—'} />
          {data.website && (
            <Detail label="Website" value={data.website} link />
          )}
          {data.identity && <Detail label="Identity" value={data.identity} />}
          {data.securityContact && <Detail label="Security Contact" value={data.securityContact} />}
        </div>
        {data.details && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border-light)]">
            <div className="detail-label mb-2">Details</div>
            <p className="text-sm whitespace-pre-wrap">{data.details}</p>
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-[var(--color-text-muted)] mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Detail({ label, value, mono, link, copy }: { label: string; value: string | null; mono?: boolean; link?: boolean; copy?: boolean }) {
  return (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className="flex min-w-0 items-start gap-1">
        <div className={`detail-value min-w-0 ${mono ? 'font-mono' : ''}`}>
          {link && value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : value || '—'}
        </div>
        {copy && value && <CopyButton text={value} />}
      </div>
    </div>
  );
}

function Signal({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-[var(--color-border-light)] bg-[var(--color-bg-primary)] p-3"><div className="text-xs text-[var(--color-text-muted)]">{label}</div><div className={`mt-1 break-all text-sm font-semibold ${tone}`}>{value}</div></div>;
}

function HealthGauge({ value }: { value: number | null }) {
  const shown = value ?? 0;
  const color = shown >= 99 ? '#10b981' : shown >= 95 ? '#f59e0b' : '#ef4444';
  return <div className="mx-auto relative h-40 w-40"><svg viewBox="0 0 120 120" className="-rotate-90"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-bg-primary)" strokeWidth="12" /><circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${shown} 100`} /></svg><div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className="text-2xl font-bold">{value == null ? '—' : `${value.toFixed(2)}%`}</div><div className="text-xs text-[var(--color-text-muted)]">uptime</div></div></div></div>;
}

function ValidatorAvatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-400/10 text-lg font-bold text-blue-400">{(name || 'V').slice(0, 2).toUpperCase()}</div>;
  return <img src={src} alt={`${name} validator profile`} className="h-16 w-16 shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] object-cover" onError={() => setFailed(true)} />;
}
