import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import ErrorState from '@/components/ErrorState';
import ValidatorBadge from '@/components/ValidatorBadge';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { NETWORK } from '@/lib/network';
import type { ApiValidator } from '@/lib/types';
import { MAINNET_VALIDATOR_PROFILES, validatorProfile } from '@/lib/validator-profiles';

type ValidatorStatus = 'all' | 'active' | 'inactive';
type ValidatorSort = 'tokens' | 'uptime' | 'commission' | 'missed';

function statusIsActive(v: ApiValidator) {
  return !v.jailed && (v.status === 'Bonded' || v.status === 'active' || v.status === 'BOND_STATUS_BONDED');
}

function uptime(v: ApiValidator) {
  return v.uptimePercentage == null ? null : Number(v.uptimePercentage);
}

function tokenAmount(raw: string | undefined) {
  if (!raw) return 0;
  try { return Number(BigInt(raw)) / 1e18; } catch { return 0; }
}

export default function ValidatorsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ValidatorStatus>('all');
  const [sort, setSort] = useState<ValidatorSort>('tokens');
  const params = new URLSearchParams({ metrics: '1', sort });
  const approvedSearch = NETWORK.isMainnet
    ? Object.entries(MAINNET_VALIDATOR_PROFILES).find(([, profile]) => profile.name.toLowerCase() === search.trim().toLowerCase())?.[0]
    : undefined;
  if (search) params.set('search', approvedSearch ?? search);
  if (status !== 'all') params.set('status', status);
  const { data, loading, error, refetch } = useApi<ApiValidator[]>(`/validators?${params.toString()}`);
  const validators = useMemo(() => (data ?? []).map((validator) => ({
    ...validator,
    moniker: validatorProfile(validator.address, NETWORK.isMainnet)?.name ?? validator.moniker,
  })), [data]);
  const active = validators.filter(statusIsActive).length;
  const totalStake = validators.reduce((sum, validator) => sum + tokenAmount(validator.tokens), 0);
  const avgUptime = useMemo(() => {
    const values = validators.map(uptime).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [validators]);
  const stakeLeaders = useMemo(
    () => [...validators].sort((a, b) => tokenAmount(b.tokens) - tokenAmount(a.tokens)).slice(0, 6),
    [validators]
  );

  return (
    <>
      <Head>
        <title>{`Validators | ${EXPLORER_TITLE}`}</title>
        <meta name="description" content="Explore Lithosphere validators, voting power, uptime, commission, and validator health." />
      </Head>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-sm font-medium uppercase tracking-wider text-litho-400">Network security</div>
          <h1 className="text-3xl font-bold">Validators</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Live staking and signing health for the current network.</p>
        </div>
        <button type="button" onClick={refetch} className="text-left text-sm text-[var(--color-text-muted)] hover:text-litho-400">Refresh data</button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Validators" value={String(validators.length)} detail={`${active} active in this view`} />
        <Metric label="Active rate" value={validators.length ? `${((active / validators.length) * 100).toFixed(1)}%` : '—'} detail="bonded and not jailed" />
        <Metric label="Voting power" value={`${formatNumber(Math.round(totalStake))} LITHO`} detail="stake in this view" />
        <Metric label="Average uptime" value={avgUptime == null ? '—' : `${avgUptime.toFixed(2)}%`} detail="current signing window" />
      </div>

      {!loading && validators.length > 0 && (
        <div className="mb-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <section className="card p-5">
            <h2 className="text-base font-semibold">Voting power distribution</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Leading validators by delegated stake in the current result set</p>
            <div className="mt-5 space-y-3">
              {stakeLeaders.map((validator) => {
                const share = totalStake > 0 ? (tokenAmount(validator.tokens) / totalStake) * 100 : 0;
                return (
                  <div key={validator.address}>
                    <div className="mb-1 flex items-center justify-between gap-4 text-xs">
                      <Link href={`/validators/${encodeURIComponent(validator.address)}`} className="truncate font-medium text-[var(--color-text-primary)] hover:text-litho-400">{validator.moniker}</Link>
                      <span className="shrink-0 font-mono text-[var(--color-text-muted)]">{share.toFixed(2)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${Math.max(1, share)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card flex items-center gap-6 p-5">
            <UptimeGauge value={avgUptime} />
            <div>
              <h2 className="text-base font-semibold">Signing health</h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Calculated from real missed-block counters over the chain&apos;s signing window.</p>
              <div className="mt-3 text-xs text-[var(--color-text-muted)]">{validators.filter((validator) => uptime(validator) != null).length} validators reporting</div>
            </div>
          </section>
        </div>
      )}

      <div className="card mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input aria-label="Search validators" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by moniker or operator address" className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm outline-none focus:border-litho-400" />
          <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-1" aria-label="Validator status">
            {(['all', 'active', 'inactive'] as ValidatorStatus[]).map((value) => <button type="button" key={value} onClick={() => setStatus(value)} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize lg:flex-none ${status === value ? 'bg-litho-400 text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{value}</button>)}
          </div>
          <select aria-label="Sort validators" value={sort} onChange={(event) => setSort(event.target.value as ValidatorSort)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm">
            <option value="tokens">Highest voting power</option><option value="uptime">Best uptime</option><option value="commission">Lowest commission</option><option value="missed">Fewest missed blocks</option>
          </select>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={refetch} /> : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[800px]">
            <thead><tr><th>#</th><th>Validator</th><th>Voting power</th><th>Uptime</th><th>Commission</th><th>Missed blocks</th><th>Status</th></tr></thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, index) => <tr key={index}><td colSpan={7}><div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-bg-tertiary)]" /></td></tr>)}
              {!loading && validators.map((validator, index) => {
                const value = uptime(validator);
                return (
                  <tr key={validator.address}>
                    <td className="text-[var(--color-text-muted)]">{index + 1}</td>
                    <td><div className="flex items-center gap-3"><ValidatorMark name={validator.moniker} /><div><Link href={`/validators/${encodeURIComponent(validator.address)}`} className="font-medium hover:underline">{validator.moniker || validator.address}</Link><div className="font-mono text-xs text-[var(--color-text-muted)]">{validator.address.slice(0, 14)}…{validator.address.slice(-6)}</div></div></div></td>
                    <td className="font-mono">{validator.votingPower} LITHO</td>
                    <td>{value == null ? '—' : <HealthBar value={value} />}</td>
                    <td>{validator.commission || '—'}</td><td>{validator.missedBlocks ?? '—'}</td>
                    <td><div className="flex flex-wrap items-center gap-2"><span className={statusIsActive(validator) ? 'badge-success' : validator.jailed ? 'badge-error' : 'badge-neutral'}>{validator.jailed ? 'Jailed' : validator.status}</span><ValidatorBadge validator={validator} /></div></td>
                  </tr>
                );
              })}
              {!loading && validators.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-[var(--color-text-muted)]">No validators match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="card p-4"><div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div><div className="mt-1 text-xs text-[var(--color-text-secondary)]">{detail}</div></div>; }
function ValidatorMark({ name }: { name: string }) { return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500/25 to-cyan-400/10 text-xs font-bold text-blue-400">{(name || 'V').slice(0, 2).toUpperCase()}</span>; }
function HealthBar({ value }: { value: number }) { const color = value >= 99 ? 'bg-emerald-500' : value >= 95 ? 'bg-amber-500' : 'bg-red-500'; return <div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-[var(--color-bg-tertiary)]"><div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div><span className="text-xs">{value.toFixed(2)}%</span></div>; }
function UptimeGauge({ value }: { value: number | null }) { const shown = value ?? 0; const color = shown >= 99 ? '#10b981' : shown >= 95 ? '#f59e0b' : '#ef4444'; return <div className="relative h-28 w-28 shrink-0"><svg viewBox="0 0 120 120" className="-rotate-90"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-bg-tertiary)" strokeWidth="10" /><circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray={`${shown} 100`} /></svg><div className="absolute inset-0 grid place-items-center text-center"><span className="text-lg font-bold">{value == null ? '—' : `${value.toFixed(1)}%`}</span></div></div>; }
