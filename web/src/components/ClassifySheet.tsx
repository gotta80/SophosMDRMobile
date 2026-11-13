import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { CaseDetails, Reference } from '../types';
import { VERDICT_CHIP, VERDICT_HINT, verdictLabel } from '../lib/format';
import Sheet from './Sheet';

const ICON: Record<string, string> = {
  false_positive: '🚫',
  true_positive_benign: '✅',
  true_positive_malicious: '⚠️',
  inconclusive: '❔',
};
const ORDER = ['false_positive', 'true_positive_benign', 'true_positive_malicious', 'inconclusive'];

/** Classificazione del caso (verdetto) con chiusura opzionale. Due passi: scelta e conferma esplicita. */
export default function ClassifySheet({
  c,
  onClose,
  onDone,
  onUnauthorized,
}: {
  c: CaseDetails;
  onClose: () => void;
  onDone: () => void;
  onUnauthorized: () => void;
}) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [verdictId, setVerdictId] = useState(c.verdict?.id ?? '');
  const [secondaryId, setSecondaryId] = useState(c.secondaryVerdict?.id ?? '');
  const [reason, setReason] = useState(c.closeReason ?? '');
  const [close, setClose] = useState(c.status !== 'resolved');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .reference()
      .then((r) => {
        setRef(r);
        // default motivazione: "Not Set" se disponibile
        setSecondaryId((cur) => cur || r.secondaryVerdicts.find((s) => s.name === 'not_set')?.id || '');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return onUnauthorized();
        setLoadErr('Impossibile caricare le opzioni di classificazione.');
      });
  }, [onUnauthorized]);

  const verdicts = ref ? [...ref.verdicts].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name)) : [];
  const verdict = verdicts.find((v) => v.id === verdictId);
  const secondary = ref?.secondaryVerdicts.find((s) => s.id === secondaryId);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.classify(c.id, {
        verdictId,
        secondaryVerdictId: secondaryId || undefined,
        closeReason: reason.trim() || undefined,
        close,
      });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setError(
        e instanceof ApiError && e.status === 403
          ? 'Permessi insufficienti: il ruolo della credenziale API non consente di modificare il caso.'
          : `Sophos ha rifiutato la modifica${e instanceof ApiError ? `: ${e.message.replace(/^GraphQL:\s*/, '')}` : '.'}`,
      );
      setStep('form');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={step === 'form' ? 'Classifica il caso' : 'Conferma'} onClose={busy ? () => {} : onClose}>
      {!ref && !loadErr && <p className="py-6 text-center text-sm text-neutral-500">Caricamento…</p>}
      {loadErr && <p className="py-6 text-center text-sm text-red-500">{loadErr}</p>}

      {ref && step === 'form' && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Esito dell'analisi</h3>
            <div className="space-y-2">
              {verdicts.map((v) => {
                const sel = v.id === verdictId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setVerdictId(v.id)}
                    role="radio"
                    aria-checked={sel}
                    className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition active:opacity-80 ${
                      sel ? 'bg-ios-blue/10 ring-2 ring-ios-blue' : 'bg-white ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
                    }`}
                  >
                    <span className="text-2xl">{ICON[v.name] ?? '•'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">{verdictLabel(v)}</span>
                      <span className="block text-xs text-neutral-500">{VERDICT_HINT[v.name] ?? ''}</span>
                    </span>
                    <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${sel ? 'border-ios-blue bg-ios-blue' : 'border-neutral-300 dark:border-neutral-600'}`}>
                      {sel && <svg viewBox="0 0 24 24" className="h-full w-full text-white" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12 4 4 8-8" /></svg>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-400">Motivazione</span>
            <select
              value={secondaryId}
              onChange={(e) => setSecondaryId(e.target.value)}
              className="w-full rounded-xl bg-white px-3 py-3 text-[16px] outline-none ring-1 ring-black/10 focus:ring-ios-blue dark:bg-neutral-900 dark:ring-white/15"
            >
              {[...ref.secondaryVerdicts].sort((a, b) => a.title.localeCompare(b.title)).map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-400">Nota (facoltativa)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Es. attività di sviluppo autorizzata dal team infrastruttura"
              className="w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[16px] outline-none ring-1 ring-black/10 focus:ring-ios-blue dark:bg-neutral-900 dark:ring-white/15"
            />
          </label>

          <button
            role="switch"
            aria-checked={close}
            onClick={() => setClose((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl bg-white p-3.5 text-left ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10"
          >
            <span>
              <span className="block text-[15px] font-semibold">Chiudi il caso</span>
              <span className="block text-xs text-neutral-500">{close ? 'Il caso passerà allo stato Chiuso.' : 'Il caso resta aperto: viene solo impostato il verdetto.'}</span>
            </span>
            <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${close ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${close ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>

          {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            disabled={!verdictId}
            onClick={() => setStep('confirm')}
            className="w-full rounded-2xl bg-ios-blue py-3.5 text-[16px] font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            Continua
          </button>
        </div>
      )}

      {ref && step === 'confirm' && verdict && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
            <p className="text-xs text-neutral-500">{c.shortId ?? c.id}</p>
            <p className="mt-0.5 text-[15px] font-semibold leading-snug">{c.title}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Esito</dt>
                <dd><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_CHIP[verdict.name] ?? ''}`}>{verdictLabel(verdict)}</span></dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Motivazione</dt>
                <dd className="text-right">{secondary?.title ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Stato</dt>
                <dd className="font-semibold">{close ? 'Verrà chiuso' : 'Resta aperto'}</dd>
              </div>
              {reason.trim() && (
                <div>
                  <dt className="text-neutral-500">Nota</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{reason.trim()}</dd>
                </div>
              )}
            </dl>
          </div>
          <p className="rounded-xl bg-amber-500/15 p-3 text-xs text-amber-800 dark:text-amber-300">
            Questa azione modifica il caso su Sophos e sarà visibile agli analisti MDR.
          </p>
          <div className="flex gap-3">
            <button disabled={busy} onClick={() => setStep('form')} className="flex-1 rounded-2xl bg-black/5 py-3.5 text-[16px] font-semibold active:opacity-70 disabled:opacity-40 dark:bg-white/10">
              Indietro
            </button>
            <button disabled={busy} onClick={submit} className="flex-1 rounded-2xl bg-ios-blue py-3.5 text-[16px] font-semibold text-white active:opacity-80 disabled:opacity-60">
              {busy ? 'Invio…' : close ? 'Conferma e chiudi' : 'Conferma'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
