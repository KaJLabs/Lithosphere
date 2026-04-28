import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatTimestamp, truncateHash, timeAgo, cleanMethod, txTypeInfo, formatValue, formatSupply, formatStrat, formatGasPrice } from '@/lib/format';
import { getPreferredTxHash } from '@/lib/tx';
import type { ApiTx } from '@/lib/types';

/* ---------- tiny helpers ---------- */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={copy}
      className="ml-2 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/50 hover:text-white/80 transition"
      title="Copy"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5 last:border-0">
      <div className="sm:w-52 shrink-0 text-sm text-white/45">{label}</div>
      <div className="flex-1 text-sm text-white break-all">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-white mb-4">{children}</h2>
  );
}

/* ---------- event log types ---------- */

interface LogAttribute {
  key: string;
  value: string;
}

interface LogEvent {
  type: string;
  attributes: LogAttribute[];
}

function parseRawLog(rawLog: string | undefined | null): LogEvent[] {
  if (!rawLog) return [];
  try {
    const parsed = JSON.parse(rawLog);
    // rawLog can be an array of {msg_index, events} or a flat array of events
    if (Array.isArray(parsed)) {
      const events: LogEvent[] = [];
      for (const entry of parsed) {
        if (entry.events && Array.isArray(entry.events)) {
          events.push(...entry.events);
        } else if (entry.type && Array.isArray(entry.attributes)) {
          events.push(entry as LogEvent);
        }
      }
      return events;
    }
    // Sometimes it's a single object with {events: [...]}
    if (parsed.events && Array.isArray(parsed.events)) {
      return parsed.events;
    }
    return [];
  } catch {
    return [];
  }
}

/* ---------- page ---------- */

export default function TransactionReceiptPage() {
  const router = useRouter();
  const { hash } = router.query;

  const { data: tx, loading, error } = useApi<ApiTx>(
    hash ? `/txs/${hash}` : null
  );

  /* --- loading skeleton --- */
  if (loading) {
    return (
      <div className="text-white animate-pulse space-y-6">
        <div className="h-8 rounded-2xl bg-white/10 w-1/3" />
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-white/10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  /* --- error state --- */
  if (error || !tx) {
    return (
      <div className="text-white">
        <div className="rounded-3xl border border-red-400/20 bg-red-400/5 p-8 text-center">
          <div className="text-lg font-medium text-red-300 mb-2">Transaction Not Found</div>
          <div className="text-sm text-white/50 mb-4">
            {error ?? 'No transaction found with this hash.'}
          </div>
          <Link href="/txs" className="text-sm text-emerald-300 hover:text-emerald-200">
            &larr; Back to Transactions
          </Link>
        </div>
      </div>
    );
  }

  /* --- derived values --- */
  const gasUsed = tx.gasUsed ? Number(tx.gasUsed) : null;
  const gasWanted = tx.gasWanted ? Number(tx.gasWanted) : null;
  const valueBig = tx.value && tx.value !== '0' ? tx.value : '0';
  const feeBig = tx.feePaid && tx.feePaid !== '0' ? tx.feePaid : '0';
  const denom = tx.denom ?? 'ulitho';
  const events = parseRawLog(tx.rawLog);
  const txHash = getPreferredTxHash(tx);
  const displayTxHash = txHash ?? 'Unavailable';

  // Compute total (value + fee) as string addition for display
  let total: string;
  try {
    total = (BigInt(valueBig) + BigInt(feeBig)).toString();
  } catch {
    total = valueBig;
  }

  return (
    <>
      <Head>
        <title>Receipt {truncateHash(displayTxHash)} | {EXPLORER_TITLE}</title>
      </Head>

      <div className="text-white space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-white/40">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          <Link href="/txs" className="hover:text-white/70 transition">Transactions</Link>
          <span>/</span>
          <span className="text-white/70">Receipt</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold mb-1">Transaction Receipt</h1>
            <div className="flex items-center flex-wrap gap-2">
              <span className="font-mono text-sm text-white/60 break-all">{displayTxHash}</span>
              {txHash && <CopyBtn text={txHash} />}
            </div>
          </div>
          {txHash ? (
            <Link
              href={`/txs/${txHash}`}
              className="text-sm text-emerald-300 hover:text-emerald-200 transition whitespace-nowrap"
            >
              View Transaction &rarr;
            </Link>
          ) : (
            <span className="text-sm text-white/30">Unavailable</span>
          )}
        </div>

        {/* Sender / Hash / Date */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-2">
          <Row label="Sender">
            {tx.fromAddr ? (
              <div className="flex items-center flex-wrap gap-2">
                <Link
                  href={`/address/${tx.fromAddr}`}
                  className="font-mono text-emerald-300 hover:text-emerald-200 transition break-all"
                >
                  {tx.fromAddr}
                </Link>
                <CopyBtn text={tx.fromAddr} />
              </div>
            ) : (
              <span className="text-white/40">&mdash;</span>
            )}
          </Row>
          <Row label="Hash">
            <div className="flex items-center flex-wrap gap-2">
              <span className="font-mono break-all">{displayTxHash}</span>
              {txHash && <CopyBtn text={txHash} />}
            </div>
          </Row>
          {tx.timestamp && (
            <Row label="Date / Time">
              <span>{formatTimestamp(tx.timestamp)}</span>
              <span className="ml-2 text-white/40">({timeAgo(tx.timestamp)})</span>
            </Row>
          )}
          <Row label="Memo">
            {tx.memo && tx.memo.trim() !== '' ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 inline-flex items-start gap-2">
                <span className="font-mono text-sm text-white/85 break-words whitespace-pre-wrap">
                  {tx.memo}
                </span>
                <CopyBtn text={tx.memo} />
              </div>
            ) : (
              <span className="text-sm italic text-white/30">(empty)</span>
            )}
          </Row>
        </div>

        {/* Transaction Action */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
          <SectionTitle>Transaction Action</SectionTitle>
          <div className="text-sm text-white/70 leading-relaxed">
            {tx.fromAddr ? (
              <>
                <Link
                  href={`/address/${tx.fromAddr}`}
                  className="font-mono text-emerald-300 hover:text-emerald-200 transition"
                >
                  {truncateHash(tx.fromAddr)}
                </Link>
                {' sent '}
                {tx.tokenTransferAmount ? (
                  <span className="font-mono text-white font-medium">
                    {tx.tokenSymbol
                      ? `${formatSupply(tx.tokenTransferAmount)} ${tx.tokenSymbol}`
                      : formatSupply(tx.tokenTransferAmount)}
                  </span>
                ) : (
                  <span className="font-mono text-white font-medium">
                    {formatValue(valueBig, denom)}
                  </span>
                )}
                {tx.toAddr ? (
                  <>
                    {' to '}
                    <Link
                      href={`/address/${tx.toAddr}`}
                      className="font-mono text-emerald-300 hover:text-emerald-200 transition"
                    >
                      {truncateHash(tx.toAddr)}
                    </Link>
                  </>
                ) : tx.contractAddress ? (
                  <>
                    {' creating contract '}
                    <Link
                      href={`/address/${tx.contractAddress}`}
                      className="font-mono text-emerald-300 hover:text-emerald-200 transition"
                    >
                      {truncateHash(tx.contractAddress)}
                    </Link>
                  </>
                ) : null}
                {(() => {
                  const info = txTypeInfo(tx.txType);
                  return (
                    <span className={`ml-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${info.color}`}>
                      {info.label}
                    </span>
                  );
                })()}
                {tx.method && (
                  <span className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-mono text-white/50">
                    {cleanMethod(tx.method)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-white/40">No action details available</span>
            )}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
          <SectionTitle>Financial Summary</SectionTitle>
          {(!tx.tokenTransferAmount || valueBig !== '0') && (
            <Row label="Value Sent">
              <span className="font-mono">
                {formatValue(valueBig, denom)}
              </span>
            </Row>
          )}
          {tx.tokenTransferAmount && (
            <Row label="Token Amount Sent">
              <span className="font-mono">
                {tx.tokenSymbol
                  ? `${formatSupply(tx.tokenTransferAmount)} ${tx.tokenSymbol}`
                  : formatSupply(tx.tokenTransferAmount)}
                {tx.contractAddress && (
                  <Link
                    href={`/token/${tx.contractAddress}`}
                    className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-white/50 hover:text-emerald-300 transition"
                  >
                    {truncateHash(tx.contractAddress, 6, 4)}
                  </Link>
                )}
              </span>
            </Row>
          )}
          <Row label="Fee">
            <span className="font-mono">
              {formatStrat(feeBig)}
            </span>
          </Row>
          <Row label="Total">
            <span className="font-mono font-medium text-white">
              {formatValue(total, denom)}
            </span>
          </Row>
        </div>

        {/* Receipt Details */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
          <SectionTitle>Receipt Details</SectionTitle>

          <Row label="Status">
            <span
              className={`inline-flex items-center gap-1.5 ${
                tx.success ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tx.success ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              {tx.success ? 'Success' : 'Failed'}
            </span>
          </Row>

          {gasUsed != null && (
            <Row label="Cumulative Gas Used">
              <span className="font-mono">{formatNumber(gasUsed)}</span>
            </Row>
          )}

          {gasWanted != null && (
            <Row label="Gas Limit">
              <span className="font-mono">{formatNumber(gasWanted)}</span>
            </Row>
          )}

          {tx.gasPrice && (
            <Row label="Effective Gas Price">
              <span className="font-mono">{formatGasPrice(tx.gasPrice)}</span>
            </Row>
          )}

          <Row label="Block Number">
            <Link
              href={`/blocks/${tx.blockHeight}`}
              className="font-mono text-emerald-300 hover:text-emerald-200 transition"
            >
              #{formatNumber(tx.blockHeight)}
            </Link>
          </Row>

          {tx.timestamp && (
            <Row label="Block Timestamp">
              <span>{formatTimestamp(tx.timestamp)}</span>
              <span className="ml-2 text-white/40">({timeAgo(tx.timestamp)})</span>
            </Row>
          )}
        </div>

        {/* Event Logs */}
        {events.length > 0 && (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
            <SectionTitle>Event Logs ({events.length})</SectionTitle>
            <div className="space-y-4">
              {events.map((evt, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden"
                >
                  {/* Event header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                    <span className="flex items-center justify-center h-6 w-6 rounded-full bg-white/10 text-xs font-mono text-white/60">
                      {idx}
                    </span>
                    <span className="text-sm font-medium text-white">{evt.type}</span>
                  </div>
                  {/* Attributes table */}
                  {evt.attributes.length > 0 && (
                    <div className="divide-y divide-white/5">
                      {evt.attributes.map((attr, attrIdx) => (
                        <div
                          key={attrIdx}
                          className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-2.5"
                        >
                          <div className="sm:w-40 shrink-0 text-xs font-mono text-white/40">
                            {attr.key}
                          </div>
                          <div className="flex-1 text-xs font-mono text-white/70 break-all">
                            {attr.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw log fallback when no parsed events */}
        {events.length === 0 && tx.rawLog && (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
            <SectionTitle>Raw Log</SectionTitle>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-white/50 max-h-60 overflow-auto whitespace-pre-wrap">
              {tx.rawLog}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
