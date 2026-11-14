import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { t } from '../lib/i18n';
import type { CaseComment, CaseDetails } from '../types';
import { fmtDateTime, timeAgo } from '../lib/format';
import { SeverityBadge, StatusText } from './Badges';
import Markdown from './Markdown';
import AiSheet from './AiSheet';
import Timeline from './Timeline';
import ClassifySheet from './ClassifySheet';
import { VERDICT_CHIP, verdictLabel } from '../lib/format';
import { useTenant } from '../lib/tenant';

interface Props {
  id: string;
  onBack: () => void;
  onUnauthorized: () => void;
}

export default function CaseDetail({ id, onBack, onUnauthorized }: Props) {
  const [c, setC] = useState<CaseDetails | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMitre, setShowMitre] = useState(false);
  const [showDetections, setShowDetections] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [sheet, setSheet] = useState<null | 'ai' | 'classify'>(null);
  const { caps, current } = useTenant();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setC(await api.caseDetails(id));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setError(e instanceof ApiError && e.status === 404 ? t('Caso non trovato') : t('Impossibile caricare il caso'));
    }
  }, [id, onUnauthorized]);

  useEffect(() => {
    load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    return () => clearInterval(iv);
  }, [load]);

  // Follows the visual viewport: the reply bar stays above the iOS virtual keyboard.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !root.current) return;
    const el = root.current;
    // With the keyboard open, iOS shrinks the visual viewport and may shift it (offsetTop): we follow both.
    const fit = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
      window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.height = '';
      el.style.transform = '';
    };
  }, []);

  // Scroll to the bottom of the chat when new messages arrive
  const count = c?.comments.length ?? 0;
  // (not on first load: we start from the top, where summary and actions are)
  const prevCount = useRef<number | null>(null);
  const loaded = !!c;
  useEffect(() => {
    if (!loaded) return;
    if (prevCount.current !== null && count > prevCount.current) {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    }
    prevCount.current = count;
  }, [count, loaded]);

  // Auto-growing textarea
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(a.scrollHeight, 140)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const comment: CaseComment = await api.addComment(id, body);
      setC((prev) => (prev ? { ...prev, comments: [...prev.comments, comment] } : prev));
      setText('');
      load(); // realign status/analysts
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setError(
        e instanceof ApiError && e.status === 403
          ? t('Permessi insufficienti: il ruolo della credenziale API Sophos non consente di scrivere commenti.')
          : t('Invio non riuscito. Riprova.'),
      );
    } finally {
      setSending(false);
    }
  }

  function addMention() {
    if (/@sophos\b/i.test(text)) return area.current?.focus();
    setText((cur) => (cur ? `${cur.replace(/\s*$/, ' ')}@sophos ` : '@sophos '));
    area.current?.focus();
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Key findings: the "Investigation Summary" part is always visible, the details are collapsible.
  const split = c?.keyFindings?.search(/^#{2,4}\s*Investigation Details/im) ?? -1;
  const kfSummary = split > 0 ? c!.keyFindings!.slice(0, split).replace(/\n-{3,}\s*$/, '') : c?.keyFindings ?? '';
  const kfDetails = split > 0 ? c!.keyFindings!.slice(split).replace(/^#{2,4}\s*Investigation Details:?\s*/i, '') : '';

  return (
    <div ref={root} className="flex h-full flex-col overflow-hidden">
      <header className="z-10 flex items-center gap-1 border-b border-black/5 bg-ios-bg/80 px-2 pb-2 pt-safe backdrop-blur-xl dark:border-white/10">
        <button onClick={onBack} className="-ml-0 flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-ios-blue active:opacity-50">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          <span className="text-[17px]">{t('Casi')}</span>
        </button>
        <span className="ml-auto truncate pr-2 text-sm font-semibold">{current.name}</span>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-3">
        {error && <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {!c && !error && <p className="mt-10 text-center text-neutral-500">{t('Caricamento…')}</p>}

        {c && (
          <>
            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeverityBadge severity={c.severity} />
                <StatusText status={c.status} />
                <span className="ml-auto text-xs text-neutral-400">{timeAgo(c.updatedAt)}</span>
              </div>
              <h1 className="text-lg font-bold leading-snug">{c.title}</h1>
              <p className="mt-1 text-xs text-neutral-500">
                {c.type} · {c.managedBy}
              </p>

              <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-1.5 dark:bg-white/10">
                <code className="min-w-0 flex-1 truncate text-xs text-neutral-600 dark:text-neutral-300">{c.id}</code>
                <button onClick={copyId} className="shrink-0 text-xs font-semibold text-ios-blue active:opacity-50">
                  {copied ? t('Copiato ✓') : t('Copia ID')}
                </button>
              </div>

              {c.verdict && (
                <div className="mt-3 rounded-xl bg-black/[0.04] p-2.5 dark:bg-white/[0.06]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-500">{t('Esito')}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_CHIP[c.verdict.name] ?? 'bg-black/5'}`}>
                      {verdictLabel(c.verdict)}
                    </span>
                    {c.secondaryVerdict && c.secondaryVerdict.name !== 'not_set' && (
                      <span className="text-xs text-neutral-500">{c.secondaryVerdict.title}</span>
                    )}
                  </div>
                  {c.closeReason && <p className="mt-1.5 whitespace-pre-wrap text-xs text-neutral-500">{c.closeReason}</p>}
                </div>
              )}

              {(caps.ai || caps.classify) && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {caps.ai && (
                <button
                  onClick={() => setSheet('ai')}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-ios-blue/10 py-2.5 text-sm font-semibold text-ios-blue active:opacity-60"
                >
                  <span aria-hidden>✨</span> {t('Spiegazione AI')}
                </button>
                )}
                {caps.classify && (
                <button
                  onClick={() => setSheet('classify')}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-semibold active:opacity-60 dark:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1" /></svg>
                  {c.verdict ? t('Modifica esito') : t('Classifica')}
                </button>
                )}
              </div>
              )}

              {!caps.comments && (
                <p className="mt-3 rounded-xl bg-amber-500/15 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  {t('Caso su Sophos Central (classic): sola lettura. Sotto trovi la cronologia con le note degli analisti; commenti, spiegazione AI e classificazione non sono disponibili da qui.')}
                </p>
              )}

              {c.summary && <p className="mt-3 whitespace-pre-wrap text-xs text-neutral-500">{c.summary}</p>}

              {c.keyFindings && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">Key findings</h3>
                  <div className="mt-1">
                    <Markdown source={kfSummary} />
                  </div>
                  {kfDetails && (
                    <Collapsible title={t("Dettagli dell'analisi")} open={showDetails} onToggle={() => setShowDetails((v) => !v)} empty={false}>
                      <Markdown source={kfDetails} />
                    </Collapsible>
                  )}
                </>
              )}

              {c.entities.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Entità coinvolte')}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.entities.map((e) => (
                      <span key={e.id} className="rounded-lg bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
                        {e.type === 'host' ? '🖥️' : e.type === 'user' ? '👤' : '•'} {e.name}
                        {e.detail && (
                          <b className={`ml-1.5 ${/^isolated$/i.test(e.detail) ? 'text-red-500' : 'text-neutral-400'}`}>
                            {e.detail.toLowerCase()}
                          </b>
                        )}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <Collapsible title={t('Detection ({n})', { n: c.detections.length })} open={showDetections} onToggle={() => setShowDetections((v) => !v)} empty={!c.detections.length}>
                <ul className="space-y-1 text-sm">
                  {c.detections.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{d.name}</span>
                      {d.severity && <SeverityBadge severity={d.severity} />}
                    </li>
                  ))}
                </ul>
              </Collapsible>

              <Collapsible title={`MITRE ATT&CK (${c.mitre.length})`} open={showMitre} onToggle={() => setShowMitre((v) => !v)} empty={!c.mitre.length}>
                <div className="flex flex-wrap gap-1.5">
                  {c.mitre.map((m) => (
                    <span key={m.id} className="rounded-md bg-ios-blue/10 px-2 py-1 text-xs text-ios-blue" title={m.tactic}>
                      <b>{m.id}</b> {m.name}
                    </span>
                  ))}
                </div>
              </Collapsible>
            </section>

            {!caps.comments && (
              <>
                <h3 className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Cronologia del caso')}</h3>
                <Timeline activities={c.activities ?? []} />
              </>
            )}

            {caps.comments && (
              <>
                <h3 className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Conversazione')}</h3>
                {c.comments.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">{t('Nessun messaggio')}</p>}
                <ol className="space-y-3">
                  {c.comments.map((m) => (
                    <Message key={m.id} m={m} />
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </div>

      {caps.comments && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-black/5 bg-ios-bg/90 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl dark:border-white/10"
      >
        <div className="flex items-end gap-2">
          <button type="button" onClick={addMention} className="mb-0.5 shrink-0 rounded-full bg-ios-blue/10 px-3 py-2 text-sm font-semibold text-ios-blue active:opacity-50">
            + @sophos
          </button>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder={t('Rispondi al caso…')}
            enterKeyHint="enter"
            className="max-h-[140px] min-h-[38px] flex-1 resize-none rounded-[19px] bg-white px-3.5 py-2 text-[16px] leading-snug outline-none ring-1 ring-black/10 focus:ring-ios-blue dark:bg-neutral-900 dark:ring-white/15"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label={t('Invia')}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ios-blue text-white active:opacity-70 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </form>
      )}

      {c && sheet === 'ai' && <AiSheet c={c} onClose={() => setSheet(null)} onUnauthorized={onUnauthorized} />}
      {c && sheet === 'classify' && (
        <ClassifySheet
          c={c}
          onClose={() => setSheet(null)}
          onUnauthorized={onUnauthorized}
          onDone={() => {
            setSheet(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Message({ m }: { m: CaseComment }) {
  if (m.author.role === 'system')
    return <li className="px-4 text-center text-xs text-neutral-400">{m.body} · {fmtDateTime(m.createdAt)}</li>;
  const mine = m.author.role === 'customer';
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <span className="mb-0.5 px-2 text-[11px] text-neutral-400">
        {mine ? t('Tu') : m.author.name} · {fmtDateTime(m.createdAt)}
      </span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
          mine ? 'rounded-br-md bg-ios-blue text-white' : 'rounded-bl-md bg-white ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10'
        }`}
      >
        {m.body}
      </div>
    </li>
  );
}

function Collapsible({ title, open, onToggle, empty, children }: { title: string; open: boolean; onToggle: () => void; empty: boolean; children: React.ReactNode }) {
  if (empty) return null;
  return (
    <div className="mt-3 border-t border-black/5 pt-2 dark:border-white/10">
      <button onClick={onToggle} className="flex w-full items-center justify-between py-1 text-sm font-semibold active:opacity-50" aria-expanded={open}>
        {title}
        <svg viewBox="0 0 24 24" className={`h-4 w-4 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
