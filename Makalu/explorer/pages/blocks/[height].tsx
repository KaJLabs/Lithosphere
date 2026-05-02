import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '@/lib/api';
import { EXPLORER_TITLE } from '@/lib/constants';
import { formatNumber, formatTimestamp, timeAgo, truncateHash, formatValue, formatStrat } from '@/lib/format';
import { getPreferredTxHash } from '@/lib/tx';
import type { ApiBlock, ApiTx, StatsSummary } from '@/lib/types';
import { FormattedValueElement } from '@/components/FormattedValueElement';
import HashDisplay from '@/components/HashDisplay';
import DataTable, { type Column } from '@/components/DataTable';
import { TxStatusBadge } from '@/components/Badges';
import ErrorState from '@/components/ErrorState';
import Loading from '@/components/Loading';

function CopyBtn({ text }: { text: string }) {
  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <button
      onClick={copy}
      className="ml-2 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/50 hover:text-white/80 transition"
      title="Copy"
    >
      copy
    </button>
  );
}

function Row({ label, children, tooltip }: { label: string; children: React.ReactNode; tooltip?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-4 border-b border-white/5 last:border-0">
      <div className="sm:w-48 shrink-0 text-sm text-white/45" title={tooltip}>{label}</div>
      <div className="flex-1 text-sm text-white break-all">{children}</div>
    </div>
  );
}

export default function BlockDetailPage() {
  const router = useRouter();
  const { height } = router.query;
  const blockNum = Number(height);

  const { data: block, loading, error, refetch } = useApi<ApiBlock>(
    height ? `/blocks/${height}` : null
  );

  const { data: stats } = useApi<StatsSummary>('/stats/summary');
  const tipHeight = stats?.tipHeight ?? 0;
  const confirmations = tipHeight && blockNum ? tipHeight - blockNum + 1 : 0;

  const txColumns: Column<ApiTx>[] = [
    {
      key: 'hash',
      header: 'Tx Hash',
      render: (tx) => {
        const txHash = getPreferredTxHash(tx);
        return txHash ? (
          <Link href={`/txs/${txHash}`} className="font-mono text-emerald-300 hover:text-emerald-200 transition">
            {truncateHash(txHash)}
          </Link>
        ) : (
          <span className="font-mono text-sm text-white/30">Unavailable</span>
        );
      },
    },
    {
      key: 'method',
      header: 'Method',
      render: (tx) => (
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/70 truncate max-w-[120px]" title={tx.methodName ?? tx.txType ?? 'Transfer'}>
          {tx.methodName ?? (tx.txType === 'call' ? 'Call' : tx.txType === 'create' ? 'Create' : 'Transfer')}
        </span>
      ),
    },
    {
      key: 'from',
      header: 'From',
      render: (tx) => (
        <Link href={`/address/${tx.fromAddr}`} className="font-mono text-sm text-emerald-300 hover:text-emerald-200">
          {truncateHash(tx.fromAddr)}
        </Link>
      ),
    },
    {
      key: 'to',
      header: 'To',
      render: (tx) => tx.toAddr ? (
        <Link href={`/address/${tx.toAddr}`} className="font-mono text-sm text-emerald-300 hover:text-emerald-200">
          {truncateHash(tx.toAddr)}
        </Link>
      ) : <span className="text-white/30">&mdash;</span>,
    },
    {
      key: 'value',
      header: 'Value',
      render: (tx) => (
        <span className="text-sm">
          <FormattedValueElement 
            formattedStr={formatValue(tx.value, tx.denom)}
            tokenAddress={tx.contractAddress}
          />
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      render: (tx) => <span className="font-mono text-sm text-white/60">{formatStrat(tx.feePaid)}</span>,
    },
    {
      key: 'memo',
      header: 'Memo',
      render: (tx) => {
        const memo = tx.memo?.trim();
        if (!memo) return <span className="text-white/25">&mdash;</span>;
        return (
          <span
            className="block max-w-[160px] truncate font-mono text-xs text-white/65"
            title={memo}
          >
            {memo}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (tx) => <TxStatusBadge success={tx.success} />,
    },
  ];

  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (loading) return <Loading lines={8} />;
  if (!block) return <ErrorState message="Block not found" />;

  return (
    <>
      <Head>
        <title>Block #{height} | {EXPLORER_TITLE}</title>
        <meta name="description" content={`View Lithosphere Makalu testnet details and transactions for block ${height}.`} />
      </Head>

      <div className="text-white">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-white/40 mb-6">
          <Link href="/" className="hover:text-white/70 transition">Home</Link>
          <span>/</span>
          <Link href="/blocks" className="hover:text-white/70 transition">Blocks</Link>
          <span>/</span>
          <span className="text-white/70 font-mono">#{formatNumber(block.height)}</span>
        </div>

        {/* Title + Navigation */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Block #{formatNumber(block.height)}</h1>
          <div className="flex items-center gap-1 ml-auto">
            {blockNum > 1 && (
              <Link
                href={`/blocks/${blockNum - 1}`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition"
              >
                &larr; Prev
              </Link>
            )}
            {tipHeight > blockNum && (
              <Link
                href={`/blocks/${blockNum + 1}`}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 transition"
              >
                Next &rarr;
              </Link>
            )}
          </div>
        </div>

        {/* Overview Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-2 mb-6">
          <Row label="Block Height">
            <span className="font-mono">{formatNumber(block.height)}</span>
          </Row>

          <Row label="Timestamp">
            <span>{formatTimestamp(block.timestamp)}</span>
            <span className="ml-2 text-white/40">({timeAgo(block.timestamp)})</span>
          </Row>

          <Row label="Transactions">
            <span>
              {block.txCount === 0 ? (
                '0 transactions'
              ) : (
                <>
                  <span className="text-emerald-300">{block.txCount} transaction{block.txCount !== 1 ? 's' : ''}</span>
                  {' '}in this block
                </>
              )}
            </span>
          </Row>

          {block.proposerAddress && (
            <Row label="Validated By" tooltip="The validator who proposed this block">
              <Link
                href={`/address/${block.proposerAddress}`}
                className="font-mono text-emerald-300 hover:text-emerald-200 transition"
              >
                {truncateHash(block.proposerAddress)}
              </Link>
              <CopyBtn text={block.proposerAddress} />
            </Row>
          )}

          <Row label="Block Hash">
            <span className="font-mono">{block.hash}</span>
            <CopyBtn text={block.hash} />
          </Row>

          {block.parentHash && (
            <Row label="Parent Hash">
              <Link
                href={`/blocks/${blockNum - 1}`}
                className="font-mono text-emerald-300 hover:text-emerald-200 transition"
              >
                {block.parentHash}
              </Link>
            </Row>
          )}

          {confirmations > 0 && (
            <Row label="Confirmations" tooltip="Number of blocks confirmed since this block">
              <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-0.5 text-xs text-emerald-300">
                {formatNumber(confirmations)} Block Confirmations
              </span>
            </Row>
          )}

          <Row label="Gas Used">
            <span className="font-mono">{block.gasUsed ? formatNumber(Number(block.gasUsed)) : '0'}</span>
          </Row>
        </div>

        {/* Genesis Information — block #1 only */}
        {blockNum === 1 && (block.chainId || block.genesisTime || block.genesisHash) && (
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/5 px-6 py-2 mb-6">
            <div className="flex items-center gap-2 py-4 border-b border-white/5">
              <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
                Genesis
              </span>
              <span className="text-sm text-white/60">
                Network metadata baked into the chain at genesis. Block #1 itself carries no memo field — the chain memo lives in <code className="font-mono text-white/75">genesis.json</code> and is summarized below.
              </span>
            </div>

            {block.chainId && (
              <Row label="Chain ID">
                <span className="font-mono">{block.chainId}</span>
                <CopyBtn text={block.chainId} />
              </Row>
            )}

            {block.genesisTime && (
              <Row label="Genesis Time">
                <span>{formatTimestamp(block.genesisTime)}</span>
                <span className="ml-2 text-white/40">({timeAgo(block.genesisTime)})</span>
              </Row>
            )}

            {block.genesisHash && (
              <Row label="Genesis Hash" tooltip="SHA-256 of genesis.json — uniquely identifies the network">
                <span className="font-mono break-all">{block.genesisHash}</span>
                <CopyBtn text={block.genesisHash} />
              </Row>
            )}
          </div>
        )}

        {/* Transactions Table */}
        {block.txs && block.txs.length > 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">
              Transactions ({block.txs.length})
            </h2>
            <DataTable
              columns={txColumns}
              data={block.txs}
              rowKey={(tx) => getPreferredTxHash(tx) ?? `${tx.blockHeight}-${tx.fromAddr}-${tx.toAddr ?? 'none'}-${tx.timestamp ?? 'unknown'}`}
            />
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
            No transactions in this block.
          </div>
        )}
      </div>
    </>
  );
}
