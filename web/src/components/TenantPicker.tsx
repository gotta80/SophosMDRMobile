import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { MdrLevel, PortfolioItem, TenantInfo } from '../types';
import { useTenant } from '../lib/tenant';
import { t as tr } from '../lib/i18n';
import Sheet from './Sheet';

const REASON: Record<string, string> = {
  access_denied: tr('Accesso negato: cliente non ancora su Fusion o senza delega al partner'),
  no_service: tr('Servizio MDR non attivo per questo cliente'),
  error: tr('Errore durante la verifica: riprova più tardi'),
};

export const KindChip = ({ kind }: { kind?: TenantInfo['kind'] }) =>
  kind ? (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        kind === 'fusion' ? 'bg-ios-blue/15 text-ios-blue' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
      }`}
    >
      {kind === 'fusion' ? 'Fusion' : 'Classic'}
    </span>
  ) : null;

/** Display name of the MDR level (product names are not translated). */
export const mdrName = (level?: MdrLevel) => (level === 'mdr_plus' ? 'MDR Plus' : level === 'mdr' ? 'MDR' : tr('Nessun MDR'));

/** MDR level tag (MDR / MDR Plus); nothing when there is no MDR or the level is unknown. */
export const MdrChip = ({ level }: { level?: MdrLevel }) => {
  if (level !== 'mdr' && level !== 'mdr_plus') return null;
  const cls = `shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
    level === 'mdr_plus' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
  }`;
  return <span className={cls}>{mdrName(level)}</span>;
};

/** Grey tag of the customers without case access (only the licenses are available). */
export const LicensesChip = ({ mode }: { mode?: TenantInfo['mode'] }) =>
  mode === 'licenses' ? (
    <span className="shrink-0 rounded bg-neutral-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
      {tr('Solo licenze')}
    </span>
  ) : null;

/** Short suffix of the id: tells apart customers with the same name. */
const idTail = (id: string) => `#${id.replace(/-/g, '').slice(-4)}`;

/** Button with the current customer: opens the customer list (with counts) to switch. Hidden with a single customer. */
export default function TenantPicker({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { tenants, current } = useTenant();
  const [open, setOpen] = useState(false);
  if (tenants.length <= 1) return null;
  const ok = tenants.filter((t) => t.status === 'ok').length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl bg-black/5 px-3 py-2 text-left active:opacity-60 dark:bg-white/10"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /></svg>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.name}</span>
        <KindChip kind={current.kind} />
        <LicensesChip mode={current.mode} />
        <MdrChip level={current.mdr} />
        <span className="hidden shrink-0 text-xs text-neutral-400 min-[420px]:inline">{tr('{n} clienti', { n: ok })}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5M7 9l5-5 5 5" /></svg>
      </button>
      {open && <TenantSheet onClose={() => setOpen(false)} onUnauthorized={onUnauthorized} />}
    </>
  );
}

function TenantSheet({ onClose, onUnauthorized }: { onClose: () => void; onUnauthorized: () => void }) {
  const { tenants, current, select, recheck, probing } = useTenant();
  const [portfolio, setPortfolio] = useState<PortfolioItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .portfolio()
      .then((p) => alive && setPortfolio(p))
      .catch((e) => e instanceof ApiError && e.status === 401 && onUnauthorized());
    return () => {
      alive = false;
    };
  }, [onUnauthorized]);

  const byId = new Map((portfolio ?? []).map((p) => [p.id, p]));
  const q = query.trim().toLowerCase();
  const rows = tenants.filter((t) => !q || `${t.name} ${t.region ?? ''} ${idTail(t.id)}`.toLowerCase().includes(q));
  const ok = rows.filter((t) => t.status === 'ok' && t.mode !== 'licenses');
  const loAll = rows.filter((t) => t.status === 'ok' && t.mode === 'licenses');
  // inactive = no active license (none, expired, or pay-as-you-go with no seat in use): hidden unless asked for
  const isInactive = (t: TenantInfo) => t.activeLicenses === 0 && t.id !== current.id;
  const inactiveCount = loAll.filter(isInactive).length;
  const lo = showInactive ? loAll : loAll.filter((t) => !isInactive(t));
  const na = rows.filter((t) => t.status !== 'ok');
  // first those with cases to handle
  ok.sort((a, b) => (byId.get(b.id)?.counts?.actionRequired ?? 0) - (byId.get(a.id)?.counts?.actionRequired ?? 0));

  return (
    <Sheet title={tr('Clienti')} onClose={onClose}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
        placeholder={tr('Cerca cliente')}
        className="mb-3 w-full rounded-xl bg-white px-3 py-2.5 text-[16px] outline-none ring-1 ring-black/10 focus:ring-ios-blue dark:bg-neutral-900 dark:ring-white/15"
      />

      <ul className="space-y-2">
        {ok.map((t) => {
          const c = byId.get(t.id)?.counts;
          const sel = t.id === current.id;
          return (
            <li key={t.id}>
              <button
                onClick={() => {
                  select(t.id);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition active:opacity-70 ${
                  sel ? 'bg-ios-blue/10 ring-2 ring-ios-blue' : 'bg-white ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{t.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                    <KindChip kind={t.kind} />
                    <MdrChip level={t.mdr} />
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {c ? tr('{a} aperti · {b} totali', { a: c.open, b: c.total }) : portfolio ? tr('{n} casi', { n: t.caseCount ?? 0 }) : tr('Caricamento…')}
                    {t.region ? ` · ${t.region}` : ''}
                  </span>
                </span>
                {c && c.actionRequired > 0 && (
                  <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{c.actionRequired} {tr('da gestire')}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {lo.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-400">{tr('Senza MDR / solo licenze ({n})', { n: lo.length })}</h3>
          <ul className="space-y-1.5">
            {lo.map((t) => {
              const sel = t.id === current.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      select(t.id);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left ring-1 transition active:opacity-70 ${
                      sel ? 'bg-ios-blue/10 ring-2 ring-ios-blue' : 'bg-white ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{t.name}</span>
                        <LicensesChip mode={t.mode} />
                        <MdrChip level={t.mdr} />
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-400">
                        {t.region ? `${t.region} · ` : ''}{idTail(t.id)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {inactiveCount > 0 && (
        <button
          onClick={() => setShowInactive((v) => !v)}
          className="mt-3 w-full rounded-xl bg-black/5 py-2.5 text-sm font-semibold text-neutral-600 active:opacity-60 dark:bg-white/10 dark:text-neutral-300"
        >
          {showInactive ? tr('Nascondi i clienti inattivi') : tr('Mostra clienti inattivi ({n})', { n: inactiveCount })}
        </button>
      )}

      {na.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-400">{tr('Non disponibili ({n})', { n: na.length })}</h3>
          <ul className="space-y-1.5">
            {na.map((t) => (
              <li key={t.id} className="rounded-xl bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                <p className="truncate text-sm text-neutral-500">{t.name}{t.region ? ` · ${t.region}` : ''} · {idTail(t.id)}</p>
                <p className="text-[11px] text-neutral-400">{t.status === 'unknown' ? tr('Verifica in corso…') : REASON[t.reason ?? 'error']}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        onClick={recheck}
        disabled={probing}
        className="mt-5 w-full rounded-2xl bg-black/5 py-3 text-[15px] font-semibold active:opacity-70 disabled:opacity-50 dark:bg-white/10"
      >
        {probing ? tr('Verifica in corso…') : tr('Ricontrolla i clienti')}
      </button>
      <p className="mt-2 text-center text-[11px] text-neutral-400">
        {tr('I clienti non disponibili vengono ricontrollati quando premi "Ricontrolla i clienti": quando passano a Fusion compaiono.')}
      </p>
    </Sheet>
  );
}
