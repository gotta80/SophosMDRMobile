import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { CaseStatus, CaseSummary } from '../types';
import { SEVERITY_BAR, timeAgo } from '../lib/format';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { SeverityBadge, StatusText } from './Badges';

type FilterKey = 'all' | 'action' | 'active' | 'resolved';
const FILTERS: { key: FilterKey; label: string; test: (s: CaseStatus) => boolean }[] = [
  { key: 'all', label: 'Tutti', test: () => true },
  { key: 'action', label: 'Action Required', test: (s) => s === 'actionRequired' },
  { key: 'active', label: 'Attivi', test: (s) => s !== 'resolved' },
  { key: 'resolved', label: 'Risolti', test: (s) => s === 'resolved' },
];

interface Props {
  onOpen: (id: string) => void;
  onUnauthorized: () => void;
  onLogout: () => void;
  mock: boolean;
}

export default function CaseList({ onOpen, onUnauthorized, onLogout, mock }: Props) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [filter, setFilter] = useState<FilterKey>(() => (sessionStorage.getItem('filter') as FilterKey) || 'all');
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setCases(await api.cases());
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setError(e instanceof ApiError ? e.message : 'Errore di rete');
    }
  }, [onUnauthorized]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const manualRefresh = async () => {
    setSpinning(true);
    await load();
    setSpinning(false);
  };
  const { pull, refreshing, threshold } = usePullToRefresh(scroller, load);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return (cases ?? []).filter((c) => f.test(c.status));
  }, [cases, filter]);

  const actionCount = (cases ?? []).filter((c) => c.status === 'actionRequired').length;

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="z-10 border-b border-black/5 bg-ios-bg/80 pt-safe backdrop-blur-xl dark:border-white/10">
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <h1 className="text-[28px] font-bold leading-tight">
            Sophos MDR {mock && <span className="ml-1 rounded bg-yellow-400/30 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-yellow-700 dark:text-yellow-300">mock</span>}
          </h1>
          <div className="flex items-center gap-1">
            <button aria-label="Aggiorna" onClick={manualRefresh} className="rounded-full p-2 text-ios-blue active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${spinning || refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            </button>
            <button aria-label="Esci" onClick={onLogout} className="rounded-full p-2 text-neutral-400 active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
        <nav className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3" aria-label="Filtri">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                sessionStorage.setItem('filter', f.key);
              }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-ios-blue text-white' : 'bg-black/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-200'
              }`}
            >
              {f.label}
              {f.key === 'action' && actionCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[11px] text-white">{actionCount}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <div ref={scroller} className="relative flex-1 overflow-y-auto overscroll-y-contain px-4 pb-safe">
        <div
          className="flex items-center justify-center text-xs text-neutral-500 transition-[height] duration-150"
          style={{ height: pull, transitionDuration: pull === 0 || refreshing ? '200ms' : '0ms' }}
        >
          {pull > 10 && (refreshing ? 'Aggiornamento…' : pull >= threshold ? 'Rilascia per aggiornare' : 'Trascina per aggiornare')}
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error}{' '}
            <button className="font-semibold underline" onClick={load}>Riprova</button>
          </div>
        )}
        {cases === null && !error && <p className="mt-10 text-center text-neutral-500">Caricamento…</p>}
        {cases && visible.length === 0 && <p className="mt-10 text-center text-neutral-500">Nessun caso</p>}

        <ul className="space-y-2.5 py-3">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onOpen(c.id)}
                className="relative w-full overflow-hidden rounded-2xl bg-white p-3.5 pl-4 text-left shadow-sm ring-1 ring-black/5 transition active:scale-[0.99] active:opacity-80 dark:bg-neutral-900 dark:ring-white/10"
              >
                <span className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_BAR[c.severity]}`} />
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={c.severity} />
                    <StatusText status={c.status} />
                  </div>
                  <span className="text-xs text-neutral-400">{timeAgo(c.updatedAt)}</span>
                </div>
                <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">{c.title}</h2>
                {!c.primaryEntity && c.shortId && <p className="mt-1 text-xs text-neutral-500">#{c.shortId} · {c.type}</p>}
                {c.primaryEntity && (
                  <p className="mt-1 flex items-center gap-1 truncate text-xs text-neutral-500">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
                    {c.primaryEntity}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
