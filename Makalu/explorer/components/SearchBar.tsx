import { useRouter } from 'next/router';
import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { isDnnsName, resolveName } from '@/lib/dnns';
import { isEvmAddress, isBech32Address, isValidatorAddress, truncateAddress } from '@/lib/format';
import { isValidTransactionHash } from '@/lib/tx';
import type { ApiToken, ApiTxList, ApiValidator } from '@/lib/types';

type Group = 'All' | 'Tokens' | 'Addresses' | 'Pages';
interface Suggestion { label: string; detail: string; href: string; group: Group }
const pages: Suggestion[] = [
  { label: 'Home', detail: 'Network overview', href: '/', group: 'Pages' },
  { label: 'Blocks', detail: 'Latest blocks', href: '/blocks', group: 'Pages' },
  { label: 'Transactions', detail: 'Latest transactions', href: '/txs', group: 'Pages' },
  { label: 'Tokens', detail: 'Explore indexed tokens', href: '/tokens', group: 'Pages' },
  { label: 'NFTs', detail: 'Explore collections', href: '/nfts', group: 'Pages' },
  { label: 'Validators', detail: 'Voting power and signing health', href: '/validators', group: 'Pages' },
];

function directResult(q: string): Suggestion | null {
  const path = /^\d+$/.test(q) ? `/blocks/${q}`
    : isValidTransactionHash(q) ? `/txs/${q}`
      : isValidatorAddress(q) ? `/validators/${q}`
        : isEvmAddress(q) || isBech32Address(q) ? `/address/${q}` : null;
  return path ? { label: q, detail: 'Go to matching block, transaction, or address', href: path, group: 'All' } : null;
}

export default function SearchBar({ onNavigate, fullWidth = false }: { onNavigate?: () => void; fullWidth?: boolean }) {
  const [query, setQuery] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group>('All');
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [panelHeight, setPanelHeight] = useState(420);
  const listId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
      const top = formRef.current?.getBoundingClientRect().bottom ?? 0;
      setPanelHeight(Math.max(0, Math.min(420, bottom - top - 16)));
    };
    const fitKeyboard = () => {
      if (window.innerWidth < 640) formRef.current?.scrollIntoView?.({ block: 'start' });
      measure();
    };
    fitKeyboard();
    viewport?.addEventListener('resize', fitKeyboard);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      viewport?.removeEventListener('resize', fitKeyboard);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.allSettled([
      apiFetch<ApiToken[]>('/tokens'), apiFetch<ApiTxList>('/txs?limit=8'),
      apiFetch<ApiValidator[]>('/validators?metrics=1'),
    ]).then(([tokens, txs, validators]) => {
      if (cancelled) return;
      const next: Suggestion[] = [];
      if (tokens.status === 'fulfilled' && Array.isArray(tokens.value)) {
        for (const token of tokens.value) next.push({
          label: `${token.name} (${token.symbol})`, detail: token.contractAddress || 'Native LITHO',
          href: `/token/${encodeURIComponent(token.type === 'native' ? 'native' : token.contractAddress || token.symbol)}`, group: 'Tokens',
        });
      }
      if (validators.status === 'fulfilled' && Array.isArray(validators.value)) {
        for (const validator of validators.value) next.push({ label: validator.moniker, detail: validator.address,
          href: `/validators/${encodeURIComponent(validator.address)}`, group: 'Addresses' });
      }
      if (txs.status === 'fulfilled' && Array.isArray(txs.value?.txs)) {
        const addresses = new Set(txs.value.txs.flatMap((tx) => [tx.fromAddr, tx.toAddr]).filter((value): value is string => !!value));
        for (const address of addresses) next.push({ label: truncateAddress(address), detail: `Recent address · ${address}`, href: `/address/${encodeURIComponent(address)}`, group: 'Addresses' });
      }
      setSuggestions(next);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!formRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const q = query.trim();
  const direct = directResult(q);
  const results = [...(direct ? [direct] : []), ...suggestions, ...pages]
    .filter((item) => (group === 'All' || item.group === group || item === direct) &&
      (!q || `${item.label} ${item.detail}`.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 16);

  const navigate = (href: string) => {
    setOpen(false); setQuery(''); setActive(-1); onNavigate?.(); void router.push(href);
  };
  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resolving) return;
    setError('');
    if (open && active >= 0 && results[active]) return navigate(results[active].href);
    if (!q) return;
    if (q.toLowerCase().endsWith('.litho')) {
      if (!isDnnsName(q)) {
        setError('Invalid .litho name. Use one label of at least 3 letters, numbers, or hyphens.');
        return;
      }
      setResolving(true);
      try {
        const address = await resolveName(q);
        if (address) navigate(`/address/${address}`);
        else setError(`No address is set for ${q.toLowerCase()}`);
      } catch { setError('Name resolution is unavailable right now.'); }
      finally { setResolving(false); }
      return;
    }
    if (direct) return navigate(direct.href);
    if (results[0]) return navigate(results[0].href);
    setError('No suggestions match. Enter a block, transaction hash, address, token name, or .litho name.');
  };

  return (
    <form ref={formRef} onSubmit={handleSearch} className="relative scroll-mt-24" onBlur={(event) => {
      // Safari touch blur can have no relatedTarget before the result receives its click.
      // Outside pointer presses close separately; keyboard focus changes still close here.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <div className="relative flex items-center">
        <input type="text" role="combobox" aria-label="Search explorer" aria-autocomplete="list"
          aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" value={query} onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              const next = results.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : -1;
              setActive(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
            }
          }}
          placeholder="Search by block, tx, address, token, or name.litho..."
          className={`w-full ${fullWidth ? '' : 'sm:w-56 lg:w-64 xl:w-72'} min-w-0 px-4 py-3 pr-12 text-base sm:text-sm rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-litho-400 focus:ring-1 focus:ring-litho-400`}
        />
        <button type="submit" disabled={resolving} className="absolute right-2 p-1 text-[var(--color-text-muted)] hover:text-litho-400 disabled:opacity-50" aria-label="Search">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </button>
      </div>
      {open && <div style={{ maxHeight: panelHeight }} className={`absolute right-0 top-full z-[200] mt-2 flex w-full ${fullWidth ? '' : 'sm:w-96'} max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-xl`}>
        <div className="flex shrink-0 items-center justify-between px-3 pt-2 text-xs font-medium text-[var(--color-text-secondary)]">
          <span>Suggested searches</span>
          <button type="button" aria-label="Close suggestions" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--color-bg-tertiary)]">×</button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2 pb-2" aria-label="Suggestion filters">
          {(['All', 'Tokens', 'Addresses', 'Pages'] as Group[]).map((tab) => <button key={tab} type="button" aria-pressed={group === tab} onClick={() => { setGroup(tab); setActive(-1); }} className={`min-h-10 shrink-0 rounded-full px-2 py-1 text-xs sm:px-3 ${group === tab ? 'bg-litho-400 text-white' : 'text-[var(--color-text-secondary)]'}`}>{tab}</button>)}
        </div>
        <ul id={listId} role="listbox" aria-label="Suggested searches" className="min-h-0 overflow-y-auto overscroll-contain p-2">
          {results.map((item, index) => <li key={`${item.group}:${item.href}`} id={`${listId}-${index}`} role="option" aria-selected={active === index}>
            <a href={item.href} onPointerEnter={(event) => { if (event.pointerType === 'mouse') setActive(index); }} onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); navigate(item.href);
            }} className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--color-bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-litho-400 ${active === index ? 'bg-[var(--color-bg-tertiary)]' : ''}`}>
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-xs font-semibold text-litho-400">{item.group === 'Tokens' ? item.label.slice(0, 1) : item.group === 'Pages' ? '↗' : '#'}</span>
              <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{item.label}</span>
              <span className="block truncate text-xs text-[var(--color-text-muted)]">{item.detail}</span>
              </span>
              <span aria-hidden="true" className="text-[var(--color-text-muted)]">›</span>
            </a>
          </li>)}
          {!results.length && <li className="p-3 text-sm text-[var(--color-text-muted)]">{isDnnsName(q) ? 'Press Enter to resolve this .litho name' : 'No matching suggestions'}</li>}
        </ul>
        <div className="hidden shrink-0 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)] sm:block">↑ ↓ Navigate · Enter Select · Esc Close</div>
      </div>}
      {(resolving || error) && <div role="status" className={`mt-1 text-xs ${error ? 'text-red-400' : 'text-[var(--color-text-muted)]'}`}>{resolving ? 'Resolving name…' : error}</div>}
    </form>
  );
}
