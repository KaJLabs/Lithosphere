import Link from 'next/link';
import { isBech32Address, isEvmAddress } from '@/lib/format';

interface FormattedValueElementProps {
  formattedStr: string;
  tokenAddress?: string | null;
}

export function FormattedValueElement({ formattedStr, tokenAddress }: FormattedValueElementProps) {
  const match = formattedStr.match(/^(.*?)\s+([^ ]+)$/);
  if (match) {
    const amount = match[1];
    const symbol = match[2];
    const linkHref = isBech32Address(symbol) || isEvmAddress(symbol)
      ? `/address/${symbol}`
      : (tokenAddress ? `/token/${tokenAddress}` : '/token/native');
    return (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono">
        <span>{amount}</span>
        <Link
          href={linkHref}
          className="shrink-0 text-emerald-400 hover:text-emerald-300 transition"
          onClick={(e) => e.stopPropagation()}
        >
          {symbol}
        </Link>
      </span>
    );
  }
  return <span className="font-mono">{formattedStr}</span>;
}
