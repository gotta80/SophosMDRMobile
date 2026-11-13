import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { CaseDetails } from '../types';
import Markdown from './Markdown';
import Sheet from './Sheet';
import { SeverityBadge } from './Badges';

type State = { status: 'idle' | 'loading' | 'done' | 'error'; text?: string; error?: string };

const errText = (e: unknown) =>
  e instanceof ApiError && e.status === 403 ? "Il ruolo della credenziale API non consente l'uso dell'AI." : 'Richiesta non riuscita. Riprova.';

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-3 text-sm text-neutral-500">
      <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin text-ios-blue" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      {label}
    </div>
  );
}

/** Spiegazione AI di Sophos: riassunto del caso + analisi per singola detection (a richiesta, ~10-15 s l'una). */
export default function AiSheet({ c, onClose, onUnauthorized }: { c: CaseDetails; onClose: () => void; onUnauthorized: () => void }) {
  const [summary, setSummary] = useState<State>({ status: 'loading' });
  const [det, setDet] = useState<Record<string, State>>({});

  useEffect(() => {
    let alive = true;
    api
      .aiCase(c.id)
      .then((text) => alive && setSummary({ status: 'done', text }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        alive && setSummary({ status: 'error', error: errText(e) });
      });
    return () => {
      alive = false;
    };
  }, [c.id, onUnauthorized]);

  async function analyze(id: string) {
    setDet((d) => ({ ...d, [id]: { status: 'loading' } }));
    try {
      const text = await api.aiDetection(c.id, id);
      setDet((d) => ({ ...d, [id]: { status: 'done', text } }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setDet((d) => ({ ...d, [id]: { status: 'error', error: errText(e) } }));
    }
  }

  return (
    <Sheet title="Spiegazione AI" onClose={onClose}>
      <p className="mb-3 rounded-xl bg-ios-blue/10 px-3 py-2 text-xs text-ios-blue">
        Generata dall'AI di Sophos, <b>solo in inglese</b>. Può contenere imprecisioni: verifica sempre i fatti.
      </p>

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Riassunto del caso</h3>
      <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
        {summary.status === 'loading' && <Spinner label="Elaborazione in corso… (circa 15 secondi)" />}
        {summary.status === 'error' && <p className="text-sm text-red-500">{summary.error}</p>}
        {summary.status === 'done' && (summary.text ? <Markdown source={summary.text} /> : <p className="text-sm text-neutral-500">Nessun riassunto disponibile.</p>)}
      </div>

      {(c.detections.length > 0 || (c.detectionIds?.length ?? 0) > 0) && (
        <>
          <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Analisi per detection</h3>
          <ul className="space-y-2.5">
            {(c.detections.length ? c.detections : (c.detectionIds ?? []).map((id) => ({ id, name: id, severity: null }))).map((d) => {
              const s = det[d.id] ?? { status: 'idle' as const };
              return (
                <li key={d.id} className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold leading-snug">{d.name}</p>
                    {d.severity && <SeverityBadge severity={d.severity} />}
                  </div>
                  {s.status === 'idle' && (
                    <button onClick={() => analyze(d.id)} className="mt-2.5 rounded-full bg-ios-blue px-3.5 py-1.5 text-sm font-semibold text-white active:opacity-70">
                      ✨ Analizza con AI
                    </button>
                  )}
                  {s.status === 'loading' && <Spinner label="Analisi in corso… (circa 12 secondi)" />}
                  {s.status === 'error' && (
                    <p className="mt-2 text-sm text-red-500">
                      {s.error} <button className="font-semibold underline" onClick={() => analyze(d.id)}>Riprova</button>
                    </p>
                  )}
                  {s.status === 'done' && <div className="mt-2.5 border-t border-black/5 pt-2.5 dark:border-white/10"><Markdown source={s.text ?? ''} /></div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
