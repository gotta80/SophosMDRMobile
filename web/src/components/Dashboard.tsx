import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { DashboardData } from '../types';
import { SEVERITY_BAR, SEVERITY_LABEL, VERDICT_BAR, verdictLabel } from '../lib/format';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import CaseCard from './CaseCard';

const PERIODS = [7, 30, 90] as const;

interface Props {
  mock: boolean;
  onOpenCase: (id: string) => void;
  onOpenList: (filter: 'all' | 'action' | 'active' | 'resolved') => void;
  onUnauthorized: () => void;
  onLogout: () => void;
}

const Card = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {aside && <span className="text-xs text-neutral-500">{aside}</span>}
    </div>
    {children}
  </section>
);

function Tile({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: string; tone?: 'alert'; onClick?: () => void }) {
  const cls = `rounded-2xl p-3.5 text-left shadow-sm ring-1 ${
    tone === 'alert' ? 'bg-red-500/10 ring-red-500/30' : 'bg-white ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
  }`;
  const inner = (
    <>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-3xl font-bold tabular-nums ${tone === 'alert' ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={`${cls} transition active:scale-[0.98]`}>{inner}</button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function BarRow({ label, count, max, color, total }: { label: string; count: number; max: number; color: string; total?: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="w-36 shrink-0 text-xs leading-tight text-neutral-600 dark:text-neutral-300">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${max ? Math.max(count ? 4 : 0, (count / max) * 100) : 0}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-500">
        {count}
        {total ? <span className="text-neutral-400"> · {Math.round((count / total) * 100)}%</span> : null}
      </span>
    </div>
  );
}

/** Andamento: un istogramma SVG (un bin per giorno, o per settimana a 90 giorni). */
function Trend({ daily, weekly }: { daily: DashboardData['daily']; weekly: boolean }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const W = 300, H = 90, gap = daily.length > 40 ? 1 : 2;
  const bw = (W - gap * (daily.length - 1)) / daily.length;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const total = daily.reduce((n, d) => n + d.count, 0);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-24 w-full" role="img" aria-label={`Casi ${weekly ? 'per settimana' : 'per giorno'}, totale ${total}`}>
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-black/10 dark:stroke-white/15" strokeWidth="1" />
        {daily.map((d, i) => {
          const h = (d.count / max) * (H - 8);
          return (
            <rect key={d.date} x={i * (bw + gap)} y={H - h} width={bw} height={Math.max(h, d.count ? 2 : 0)} rx="1.5" className="fill-ios-blue">
              <title>{`${fmt(d.date)}: ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-neutral-400">
        <span>{fmt(daily[0].date)}</span>
        <span>{weekly ? 'casi per settimana' : 'casi per giorno'} · picco {max}</span>
        <span>oggi</span>
      </figcaption>
    </figure>
  );
}

export default function Dashboard({ mock, onOpenCase, onOpenList, onUnauthorized, onLogout }: Props) {
  const [days, setDays] = useState<number>(() => Number(sessionStorage.getItem('dashDays')) || 30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard(days));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setError('Impossibile caricare le metriche.');
    }
  }, [days, onUnauthorized]);

  useEffect(() => {
    setData((d) => (d && d.days === days ? d : null));
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, days]);

  const { pull, refreshing, threshold } = usePullToRefresh(scroller, load);
  const manual = async () => {
    setSpinning(true);
    await load();
    setSpinning(false);
  };

  const sevMax = Math.max(1, ...(data?.bySeverity.map((s) => s.count) ?? [0]));
  const verdictMax = Math.max(1, ...(data?.byVerdict.map((v) => v.count) ?? [0]));
  const judged = data?.byVerdict.filter((v) => v.name !== 'none') ?? [];
  const judgedTotal = judged.reduce((n, v) => n + v.count, 0);
  const fp = data?.byVerdict.find((v) => v.name === 'false_positive')?.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="z-10 border-b border-black/5 bg-ios-bg/80 pt-safe backdrop-blur-xl dark:border-white/10">
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <h1 className="text-[28px] font-bold leading-tight">
            Dashboard {mock && <span className="ml-1 rounded bg-yellow-400/30 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-yellow-700 dark:text-yellow-300">mock</span>}
          </h1>
          <div className="flex items-center gap-1">
            <button aria-label="Aggiorna" onClick={manual} className="rounded-full p-2 text-ios-blue active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${spinning || refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            </button>
            <button aria-label="Esci" onClick={onLogout} className="rounded-full p-2 text-neutral-400 active:bg-black/5 dark:active:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div role="tablist" aria-label="Periodo" className="flex rounded-xl bg-black/5 p-0.5 dark:bg-white/10">
            {PERIODS.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={days === p}
                onClick={() => {
                  setDays(p);
                  sessionStorage.setItem('dashDays', String(p));
                }}
                className={`flex-1 rounded-[10px] py-1.5 text-sm font-medium transition ${days === p ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
              >
                {p} giorni
              </button>
            ))}
          </div>
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4">
        <div
          className="flex items-center justify-center text-xs text-neutral-500 transition-[height]"
          style={{ height: pull, transitionDuration: pull === 0 || refreshing ? '200ms' : '0ms' }}
        >
          {pull > 10 && (refreshing ? 'Aggiornamento…' : pull >= threshold ? 'Rilascia per aggiornare' : 'Trascina per aggiornare')}
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error} <button className="font-semibold underline" onClick={load}>Riprova</button>
          </div>
        )}
        {!data && !error && <p className="mt-10 text-center text-neutral-500">Caricamento…</p>}

        {data && (
          <div className="space-y-3.5 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Da gestire" value={data.kpi.actionRequiredCases} sub="azione richiesta" tone={data.kpi.actionRequiredCases > 0 ? 'alert' : undefined} onClick={() => onOpenList('action')} />
              <Tile label="Casi aperti" value={data.kpi.openCases} sub="in corso ora" onClick={() => onOpenList('active')} />
              <Tile label={`Casi (${data.days} gg)`} value={data.kpi.totalCases} sub={`${data.kpi.escalatedCases} escalation · ${data.kpi.weekendCases} nel weekend`} onClick={() => onOpenList('all')} />
              <Tile label="Impegno SOC" value={<>{data.kpi.effortHours}<span className="text-lg font-semibold text-neutral-400"> h</span></>} sub="ore di analisi Sophos" />
            </div>

            {data.attention.length > 0 && (
              <section>
                <h2 className="mb-2 px-1 text-sm font-semibold text-red-600 dark:text-red-400">Richiedono la tua azione</h2>
                <div className="space-y-2.5">
                  {data.attention.map((c) => <CaseCard key={c.id} c={c} onOpen={onOpenCase} />)}
                </div>
              </section>
            )}

            <Card title="Andamento" aside={`${data.kpi.totalCases} casi`}>
              <Trend daily={data.daily} weekly={data.days > 31} />
            </Card>

            <Card title="Per severità">
              {data.bySeverity.map((s) => (
                <BarRow key={s.key} label={SEVERITY_LABEL[s.key]} count={s.count} max={sevMax} color={SEVERITY_BAR[s.key]} />
              ))}
            </Card>

            <Card title="Esito delle analisi" aside={judgedTotal > 0 ? `falsi positivi ${Math.round((fp / judgedTotal) * 100)}%` : undefined}>
              {data.byVerdict.length === 0 && <p className="text-sm text-neutral-500">Nessun caso nel periodo.</p>}
              {data.byVerdict.map((v) => (
                <BarRow key={v.name} label={verdictLabel(v)} count={v.count} max={verdictMax} color={VERDICT_BAR[v.name] ?? 'bg-neutral-400'} />
              ))}
            </Card>

            <p className="pb-2 text-center text-[11px] text-neutral-400">
              Aggiornato alle {new Date(data.generatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
