import Head from 'next/head';
import { FormEvent, useState } from 'react';

import { apiFetch, useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import {
  normalizeQuanttSnapshot,
  type QuanttInsightResponse,
  type QuanttStatus,
} from '@/lib/quantt';

export default function QuanttPage() {
  const { data: status, loading: statusLoading, error: statusError } = useApi<QuanttStatus>('/quantt/status');
  const [symbol, setSymbol] = useState('BTC');
  const [result, setResult] = useState<QuanttInsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{2,20}$/.test(normalized)) {
      setError('Enter a valid asset symbol.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await apiFetch<QuanttInsightResponse>(`/quantt/insights?symbol=${encodeURIComponent(normalized)}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Quantt insights are unavailable.');
    } finally {
      setLoading(false);
    }
  }

  const insight = result ? normalizeQuanttSnapshot(result.data) : null;

  return (
    <>
      <Head>
        <title>{`QUANTTS Research | ${EXPLORER_TITLE}`}</title>
        <meta name="description" content="Quantt market research integration for Lithosphere assets" />
      </Head>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 shadow-2xl sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-litho-400">QUANTTS research</p>
          <h1 className="mt-3 text-3xl font-semibold text-[var(--color-text-primary)]">Market research</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            Explore market snapshots from QUANTTS. Search a supported asset to view its latest price, daily change, and trading volume.
          </p>

          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <a className="text-litho-400 hover:underline" href={status?.researchUrl ?? 'https://quantts.ai/'} target="_blank" rel="noreferrer">Research portal ↗</a>
          </div>

          {statusLoading && <p className="mt-8 text-sm text-[var(--color-text-muted)]">Checking integration status…</p>}
          {statusError && <p className="mt-8 rounded-xl border border-red-400/20 bg-red-950/30 p-4 text-sm text-red-200">{statusError}</p>}
          {status && !status.configured && (
            <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
              In-explorer insights are not available yet. You can continue to the QUANTTS research portal using the link above.
            </div>
          )}

          {status?.configured && <form className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row" onSubmit={submit}>
            <label className="sr-only" htmlFor="quantt-symbol">Asset symbol</label>
            <input
              id="quantt-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="BTC"
              maxLength={20}
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-3 text-[var(--color-text-primary)] outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={!status?.configured || loading}
              className="rounded-xl bg-litho-400 px-5 py-3 font-medium text-[#ffffff] transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Get market snapshot'}
            </button>
          </form>}

          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
          {insight && (
            <article className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{insight.symbol}</h2>
                <time dateTime={insight.as_of} className="text-xs text-[var(--color-text-muted)]">As of {new Date(insight.as_of).toLocaleString()}</time>
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-3">
                <div><dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Price</dt><dd className="mt-1 break-words text-[var(--color-text-primary)]">{insight.price.toLocaleString('en-US', { maximumSignificantDigits: 12 })}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">24h change</dt><dd className="mt-1 text-[var(--color-text-primary)]">{insight.change_pct_24h == null ? 'Unavailable' : `${insight.change_pct_24h.toFixed(2)}%`}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">24h volume</dt><dd className="mt-1 break-words text-[var(--color-text-primary)]">{insight.volume_24h == null ? 'Unavailable' : insight.volume_24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}</dd></div>
              </dl>
              <p className="mt-5 text-xs leading-5 text-[var(--color-text-muted)]">Source: QUANTTS{insight.metadata.source ? ` / ${insight.metadata.source}` : ''}. Price and volume are shown in the provider's quoted units; the snapshot does not specify a quote currency.</p>
            </article>
          )}
        </section>
      </main>
    </>
  );
}
