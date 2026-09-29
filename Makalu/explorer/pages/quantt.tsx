import Head from 'next/head';
import { FormEvent, useState } from 'react';

import { apiFetch, useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import {
  normalizeQuanttInsight,
  type QuanttInsightResponse,
  type QuanttStatus,
} from '@/lib/quantt';

export default function QuanttPage() {
  const { data: status, loading: statusLoading, error: statusError } = useApi<QuanttStatus>('/quantt/status');
  const [symbol, setSymbol] = useState('LITHO');
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

  const insight = result ? normalizeQuanttInsight(result.data) : null;

  return (
    <>
      <Head>
        <title>Quantt Research | {EXPLORER_TITLE}</title>
        <meta name="description" content="Quantt market research integration for Lithosphere assets" />
      </Head>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 shadow-2xl dark:border-sky-300/15 dark:bg-slate-950/70 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700 dark:text-sky-300">Quantt integration</p>
          <h1 className="mt-3 text-3xl font-semibold text-[var(--color-text-primary)] dark:text-white">AI market research</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)] dark:text-slate-300">
            Query approved Quantt insights through the Lithosphere API. Provider credentials remain server-side.
          </p>

          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <a className="text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200" href={status?.researchUrl ?? 'https://research.quantt.at/'} target="_blank" rel="noreferrer">Research portal ↗</a>
            <a className="text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200" href={status?.developerUrl ?? 'https://dev.quantts.ai/'} target="_blank" rel="noreferrer">Developer portal ↗</a>
          </div>

          {statusLoading && <p className="mt-8 text-sm text-[var(--color-text-muted)] dark:text-slate-400">Checking integration status…</p>}
          {statusError && <p className="mt-8 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-950/30 dark:text-red-200">{statusError}</p>}
          {status && !status.configured && (
            <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-300/20 dark:bg-amber-950/20 dark:text-amber-100">
              Quantt API access is awaiting the approved endpoint, schema, and server credential. The integration is fail-closed until those are configured.
            </div>
          )}

          <form className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row" onSubmit={submit}>
            <label className="sr-only" htmlFor="quantt-symbol">Asset symbol</label>
            <input
              id="quantt-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="LITHO"
              maxLength={20}
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-3 text-[var(--color-text-primary)] outline-none focus:border-sky-500 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={!status?.configured || loading}
              className="rounded-xl bg-sky-700 px-5 py-3 font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              {loading ? 'Loading…' : 'Get insight'}
            </button>
          </form>

          {error && <p className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
          {insight && (
            <article className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] dark:text-white">{result?.symbol}</h2>
                {insight.updatedAt && <time className="text-xs text-[var(--color-text-muted)] dark:text-slate-400">{insight.updatedAt}</time>}
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] dark:text-slate-500">Signal</dt><dd className="mt-1 text-[var(--color-text-primary)] dark:text-slate-100">{insight.signal ?? 'Not supplied'}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] dark:text-slate-500">Score</dt><dd className="mt-1 text-[var(--color-text-primary)] dark:text-slate-100">{insight.score ?? 'Not supplied'}</dd></div>
              </dl>
              <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)] dark:text-slate-300">{insight.summary ?? 'Quantt returned data without a recognized summary field.'}</p>
            </article>
          )}
        </section>
      </main>
    </>
  );
}
