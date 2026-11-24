import { useState } from 'react';

export default function TokenIcon({ symbol, address, logoUrl, className = 'h-5 w-5' }: {
  symbol: string; address?: string | null; logoUrl?: string | null; className?: string;
}) {
  // Native identity is determined by its address, never a user-created symbol.
  const src = logoUrl || (address === 'native' || (!address && symbol === 'LITHO') ? '/litho-logo.png'
    : address ? `/api/tokens/${encodeURIComponent(address)}/icon` : null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return src && src !== failedSource ? (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
      className={`inline-block shrink-0 rounded-full object-contain ${className}`}
      onError={() => setFailedSource(src)} />
  ) : (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs text-violet-700 dark:text-violet-300 ${className}`}>
      {symbol.charAt(0).toUpperCase()}
    </span>
  );
}
