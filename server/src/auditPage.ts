/** HTML of the audit log page (/admin/audit): server-rendered, no scripts, not linked from the app. */
import type { AuditEntry } from './audit';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LABELS: Record<string, [string, string]> = {
  login: ['Accesso', 'Sign-in'],
  login_failed: ['Accesso fallito', 'Failed sign-in'],
  login_blocked: ['Accesso bloccato (troppi tentativi)', 'Sign-in blocked (too many attempts)'],
  logout: ['Uscita', 'Sign-out'],
  case_open: ['Caso aperto', 'Case opened'],
  comment: ['Commento inviato', 'Comment sent'],
  classify: ['Caso classificato', 'Case classified'],
  ai_summary: ['Spiegazione AI', 'AI explanation'],
  ai_detection: ['Analisi AI detection', 'AI detection analysis'],
  recheck: ['Ricontrollo clienti', 'Customers re-check'],
};
const WRITES = new Set(['comment', 'classify']);

const when = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function renderAuditPage(all: AuditEntry[], opts: { user?: string; action?: string; limit: number; lang: 'it' | 'en' }): string {
  const L = opts.lang === 'en' ? 1 : 0;
  const t = (it: string, en: string) => (L ? en : it);
  const rows = all.filter((e) => (!opts.user || e.user === opts.user) && (!opts.action || e.action === opts.action)).slice(0, opts.limit);
  const users = [...new Set(all.map((e) => e.user))].sort();
  const actions = [...new Set(all.map((e) => e.action))].sort();
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(opts.user ? { user: opts.user } : {}), ...(opts.action ? { action: opts.action } : {}), ...(L ? { lang: 'en' } : {}), ...extra });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : '?';
  };
  const chip = (label: string, href: string, on: boolean) => `<a class="chip${on ? ' on' : ''}" href="${esc(href)}">${esc(label)}</a>`;

  return `<!doctype html>
<html lang="${L ? 'en' : 'it'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(t('Registro attività', 'Activity log'))}</title>
<style>
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--fg:#1c1c1e;--mut:#6b6b70;--line:#0000001a;--blue:#0a84ff;--warn:#d9480f}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#f2f2f7;--mut:#9a9aa0;--line:#ffffff1f;--warn:#ff922b}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:0 0 4px}p.sub{margin:0 0 12px;color:var(--mut)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.chip{padding:3px 10px;border-radius:99px;background:var(--card);color:var(--fg);text-decoration:none;border:1px solid var(--line);font-size:12px}
.chip.on{background:var(--blue);color:#fff;border-color:var(--blue)}
.wrap{overflow-x:auto;background:var(--card);border-radius:12px;border:1px solid var(--line)}
table{border-collapse:collapse;width:100%;min-width:720px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--mut);font-weight:600}tr:last-child td{border-bottom:0}
.w{font-weight:600}.bad{color:var(--warn)}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
</style></head><body><main>
<h1>${esc(t('Registro attività', 'Activity log'))}</h1>
<p class="sub">${esc(t(`${rows.length} eventi (più recenti per primi). Utenti = PIN in ordine: user1, user2…`, `${rows.length} events (newest first). Users = PINs in order: user1, user2…`))}</p>
<div class="chips">${chip(t('Tutti gli utenti', 'All users'), q({ user: '' }), !opts.user)}${users.map((u) => chip(u, q({ user: u }), opts.user === u)).join('')}</div>
<div class="chips">${chip(t('Tutte le azioni', 'All actions'), q({ action: '' }), !opts.action)}${actions.map((a) => chip((LABELS[a] ?? [a, a])[L], q({ action: a }), opts.action === a)).join('')}</div>
<div class="wrap"><table><thead><tr><th>${esc(t('Quando', 'When'))}</th><th>${esc(t('Utente', 'User'))}</th><th>${esc(t('Azione', 'Action'))}</th><th>${esc(t('Cliente', 'Customer'))}</th><th>${esc(t('Caso', 'Case'))}</th><th>${esc(t('Dettaglio', 'Detail'))}</th><th>IP</th></tr></thead><tbody>
${rows
  .map(
    (e) =>
      `<tr><td>${esc(when(e.at, 'Europe/Rome'))}</td><td>${esc(e.user)}</td><td class="${WRITES.has(e.action) ? 'w' : ''}${e.action.startsWith('login_') ? ' bad' : ''}">${esc((LABELS[e.action] ?? [e.action, e.action])[L])}</td><td>${esc(e.tenant)}</td><td class="mono">${esc(e.caseId)}</td><td>${esc(e.detail)}</td><td class="mono">${esc(e.ip)}</td></tr>`,
  )
  .join('\n')}
</tbody></table></div>
</main></body></html>`;
}
