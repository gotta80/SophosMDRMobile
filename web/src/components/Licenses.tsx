import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { locale, t } from '../lib/i18n';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { useTenant } from '../lib/tenant';
import type { LicenseItem, TenantLicenses } from '../types';
import LangToggle from './LangToggle';
import TenantPicker, { mdrName } from './TenantPicker';

const DAY_MS = 86_400_000;
const SOON_DAYS = 90;

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });

/** Days left before the (inclusive) end date; negative when expired. */
const daysLeft = (end: string) => Math.ceil((Date.parse(`${end}T00:00:00Z`) + DAY_MS - Date.now()) / DAY_MS);

function Chip({ tone, children }: { tone: 'neutral' | 'red' | 'orange' | 'mdr'; children: React.ReactNode }) {
  const cls = {
    neutral: 'bg-black/5 text-neutral-600 dark:bg-white/10 dark:text-neutral-300',
    red: 'bg-red-500/15 text-red-600 dark:text-red-400',
    orange: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    mdr: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  }[tone];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function LicenseCard({ l }: { l: LicenseItem }) {
  const [open, setOpen] = useState(false);
  const left = l.endDate && !l.perpetual ? daysLeft(l.endDate) : null;
  const dates = [l.startDate && fmtDate(l.startDate), l.perpetual ? t('Perpetua') : l.endDate && fmtDate(l.endDate)].filter(Boolean);
  return (
    <li className={`rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10 ${l.expired ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {l.mdr && <Chip tone="mdr">MDR</Chip>}
        <Chip tone="neutral">{l.type === 'term' ? t('A termine') : l.type === 'usage' ? t('A consumo') : t('Altro')}</Chip>
        {l.expired ? (
          <Chip tone="red">{t('Scaduta')}</Chip>
        ) : left !== null && left <= SOON_DAYS ? (
          <Chip tone="orange">{t('Scade tra {n} gg', { n: Math.max(left, 0) })}</Chip>
        ) : null}
      </div>
      <p className="mt-1.5 text-[15px] font-semibold leading-snug">{l.name}</p>
      <p className="mt-0.5 break-all font-mono text-[11px] text-neutral-400">{l.code}</p>

      {(l.quantity != null || l.unlimited || l.usage != null) && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {l.unlimited ? t('Illimitata') : l.quantity != null ? t('Quantità: {n}', { n: l.quantity }) : null}
          {l.usage != null && (
            <>
              {l.unlimited || l.quantity != null ? ' · ' : ''}
              <span className={l.quantity != null && l.usage > l.quantity ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{t('In uso: {n}', { n: l.usage })}</span>
            </>
          )}
        </p>
      )}
      {dates.length > 0 && <p className="mt-0.5 text-xs text-neutral-500">{dates.join(' – ')}</p>}

      {l.features && l.features.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs font-semibold text-ios-blue active:opacity-60">
            {t('Funzionalità ({n})', { n: l.features.length })} {open ? '▴' : '▾'}
          </button>
          {open && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {l.features.map((f) => (
                <span key={f} className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-white/10">{f}</span>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Licenses tab: MDR level of the selected customer and the detail of all its licenses. */
export default function Licenses({ mock, onUnauthorized, onLogout }: { mock: boolean; onUnauthorized: () => void; onLogout: () => void }) {
  const { current, tenants } = useTenant();
  const [data, setData] = useState<TenantLicenses | null>(null);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (force = false) => {
      try {
        setData(await api.licenses(force));
        setError('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setError(t('Impossibile caricare le licenze.'));
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  const { pull, refreshing, threshold } = usePullToRefresh(scroller, refresh);
  const manual = async () => {
    setSpinning(true);
    await refresh();
    setSpinning(false);
  };

  // Pay-as-you-go (MSP) licenses with no seat in use are hidden unless the user asks for them
  const [showUnused, setShowUnused] = useState(false);
  const isUnused = (l: LicenseItem) => l.type === 'usage' && l.usage === 0;
  const unusedCount = useMemo(() => (data?.licenses ?? []).filter(isUnused).length, [data]);

  // MDR products first, then by name
  const sorted = useMemo(
    () =>
      [...(data?.licenses ?? [])]
        .filter((l) => showUnused || !isUnused(l))
        .sort((a, b) => Number(b.mdr) - Number(a.mdr) || a.name.localeCompare(b.name)),
    [data, showUnused],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="z-10 border-b border-black/5 bg-ios-bg/80 pt-safe backdrop-blur-xl dark:border-white/10">
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <h1 className="text-[28px] font-bold leading-tight">
            {t('Licenze')} {mock && <span className="ml-1 rounded bg-yellow-400/30 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-yellow-700 dark:text-yellow-300">mock</span>}
          </h1>
          <div className="flex items-center gap-1">
            <button aria-label={t('Aggiorna')} onClick={manual} className="rounded-full p-2 text-ios-blue active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${spinning || refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            </button>
            <LangToggle />
            <button aria-label={t('Esci')} onClick={onLogout} className="rounded-full p-2 text-neutral-400 active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
        <TenantPicker onUnauthorized={onUnauthorized} />
        {/* with a single customer the picker is hidden: show the name here */}
        {tenants.length <= 1 ? <p className="px-4 pb-3 text-sm text-neutral-500">{current.name}</p> : <div className="pb-1" />}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4">
        <div
          className="flex items-center justify-center text-xs text-neutral-500 transition-[height]"
          style={{ height: pull, transitionDuration: pull === 0 || refreshing ? '200ms' : '0ms' }}
        >
          {pull > 10 && (refreshing ? t('Aggiornamento…') : pull >= threshold ? t('Rilascia per aggiornare') : t('Trascina per aggiornare'))}
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error} <button className="font-semibold underline" onClick={() => load(true)}>{t('Riprova')}</button>
          </div>
        )}
        {!data && !error && <p className="mt-10 text-center text-neutral-500">{t('Caricamento…')}</p>}

        {data && (
          <div className="space-y-3 pt-3">
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
              <p className="text-xs text-neutral-500">{t('Livello MDR')}</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-bold">
                {mdrName(data.mdr)}
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                {t('{n} licenze', { n: data.licenses.length - (showUnused ? 0 : unusedCount) })} · {t('Aggiornato alle')}{' '}
                {new Date(data.fetchedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
              </p>
            </section>

            {sorted.length === 0 && <p className="mt-6 text-center text-neutral-500">{t('Nessuna licenza trovata.')}</p>}
            <ul className="space-y-2.5">
              {sorted.map((l) => (
                <LicenseCard key={l.id} l={l} />
              ))}
            </ul>
            {unusedCount > 0 && (
              <button
                onClick={() => setShowUnused((s) => !s)}
                className="w-full rounded-xl bg-black/5 py-2.5 text-sm font-semibold text-neutral-600 active:opacity-60 dark:bg-white/10 dark:text-neutral-300"
              >
                {showUnused ? t('Nascondi le licenze non in uso') : t('Mostra anche le licenze non in uso ({n})', { n: unusedCount })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
