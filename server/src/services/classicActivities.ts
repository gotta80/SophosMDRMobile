/**
 * Parses the activity log of Sophos Central classic (GET /cases/v1/cases/{id}/activities).
 * Each row is {userName, userEmail?, action, category, createdAt}; `action` is free text, for example:
 *   Status changed from "on_hold" to "taking_action", notes changed from "" to "<analyst text>"
 *   Tags changed from "[]" to "["x"]"
 *   Created MdrCase ID: 934580 - <title>
 *   Triggered the "Block user" action ...
 * Analyst notes arrive as "notes changed": we show them as messages. Undocumented endpoint
 * but verified on a real tenant; if the format changes, unrecognized rows remain visible as text.
 */
import type { Activity, ActivityChange } from '../types';
import { currentLang } from '../lang';

type Raw = { userName?: string; userEmail?: string; action?: string; category?: string; createdAt?: string };

const STATUS_EN: Record<string, string> = {
  new: 'New',
  triage: 'Triage',
  investigating: 'Investigating',
  taking_action: 'Taking action',
  on_hold: 'On hold',
  waiting_on_client: 'Waiting on customer',
  waiting_on_customer: 'Waiting on customer',
  action_required: 'Action required',
  customer_action_required: 'Action required',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_IT: Record<string, string> = {
  new: 'Nuovo',
  triage: 'Triage',
  investigating: 'In analisi',
  taking_action: 'Azione in corso',
  on_hold: 'In attesa',
  waiting_on_client: 'In attesa del cliente',
  waiting_on_customer: 'In attesa del cliente',
  action_required: 'Azione richiesta',
  customer_action_required: 'Azione richiesta',
  resolved: 'Risolto',
  closed: 'Chiuso',
};

const LABEL_EN: Record<string, string> = {
  status: 'Status',
  severity: 'Severity',
  owner_email: 'Assigned to',
  tags: 'Tags',
  case_queue: 'Queue',
  collaborators: 'Collaborators',
  escalated: 'Escalated',
  pending_reason: 'Pending reason',
  customer_responded: 'Customer responded',
  taking_action_type: 'Action type',
  taking_action_details: 'Action details',
  investigation_type: 'Investigation type',
  investigation_reason: 'Investigation reason',
};

const LABEL_IT: Record<string, string> = {
  status: 'Stato',
  severity: 'Severità',
  owner_email: 'Assegnato a',
  tags: 'Tag',
  case_queue: 'Coda',
  collaborators: 'Collaboratori',
  escalated: 'Escalation',
  pending_reason: 'Motivo attesa',
  customer_responded: 'Cliente ha risposto',
  taking_action_type: 'Tipo di azione',
  taking_action_details: 'Dettagli azione',
  investigation_type: 'Tipo di indagine',
  investigation_reason: 'Motivo indagine',
};

/** Minor ("side") fields: only useful for the technical detail. */
const MINOR = new Set(['case_queue', 'collaborators', 'tags', 'taking_action_type', 'taking_action_details', 'investigation_type', 'investigation_reason', 'pending_reason']);

const SEVERITY_IT: Record<string, string> = { '2': 'Informational', '4': 'Low', '6': 'Medium', '8': 'High', '10': 'Critical' };

const humanize = (v: string) => ((currentLang() === 'en' ? STATUS_EN : STATUS_IT)[v] ?? v.replace(/_/g, ' ')).trim();
const labelOf = (f: string) => (currentLang() === 'en' ? LABEL_EN : LABEL_IT)[f] ?? humanize(f);

function pretty(field: string, v: string): string {
  if (field === 'status') return humanize(v);
  if (field === 'severity') return SEVERITY_IT[v] ?? (v || '—');
  if (field === 'tags') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? (a.length ? a.join(', ') : '—') : v;
    } catch {
      return v.replace(/^\[|\]$/g, '').replace(/"/g, '') || '—';
    }
  }
  if (field === 'owner_email' || field === 'escalated' || field === 'pending_reason') return v || '—';
  return v || '—';
}

/** Splits "a changed from "x" to "y", b changed from ..." into a list of changes (inner quotes are not escaped). */
function parseChanges(action: string): { field: string; from: string; to: string }[] {
  const starts: { i: number; bodyAt: number; field: string }[] = [];
  const re = /(^|, )([A-Za-z_]+) changed from "/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(action))) starts.push({ i: m.index + m[1].length, bodyAt: m.index + m[0].length, field: m[2].toLowerCase() });
  const out: { field: string; from: string; to: string }[] = [];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i - 2 : action.length; // -2 = the ", " preceding the next change
    const body = action.slice(s.bodyAt, Math.max(end, s.bodyAt));
    const sep = body.indexOf('" to "');
    if (sep < 0) return;
    out.push({ field: s.field, from: body.slice(0, sep), to: body.slice(sep + 6).replace(/"$/, '') });
  });
  return out;
}

export function parseActivities(rows: Raw[]): Activity[] {
  const out: Activity[] = [];
  rows.forEach((r, idx) => {
    const action = String(r.action ?? '');
    const at = String(r.createdAt ?? '');
    const who = String(r.userName ?? r.userEmail ?? (currentLang() === 'en' ? 'System' : 'Sistema'));
    const id = `${at}-${idx}`;
    const category = String(r.category ?? '');

    const changes = parseChanges(action);
    if (changes.length) {
      const note = changes.find((c) => c.field === 'notes');
      const rest: ActivityChange[] = changes
        .filter((c) => c.field !== 'notes')
        .map((c) => ({ label: labelOf(c.field), from: pretty(c.field, c.from), to: pretty(c.field, c.to) }));
      const onlyMinor = changes.every((c) => c.field === 'notes' ? false : MINOR.has(c.field));
      if (note && note.to.trim()) {
        // under the note only the relevant changes are shown (status, assignment, severity...), not the technical ones
        const major = changes
          .filter((c) => c.field !== 'notes' && !MINOR.has(c.field))
          .map((c) => ({ label: labelOf(c.field), from: pretty(c.field, c.from), to: pretty(c.field, c.to) }));
        out.push({ id, at, who, kind: 'note', text: note.to.trim(), changes: major.length ? major : undefined });
      } else if (rest.length) {
        const isStatus = changes.some((c) => c.field === 'status');
        out.push({ id, at, who, kind: isStatus ? 'status' : 'change', changes: rest, minor: onlyMinor });
      }
      return;
    }

    if (/^created\b/i.test(action)) return void out.push({ id, at, who, kind: 'created', text: action });
    if (category === 'messages') return void out.push({ id, at, who, kind: 'message', text: action });
    if (category === 'ai') return void out.push({ id, at, who, kind: 'ai', text: action });
    if (category === 'files') return void out.push({ id, at, who, kind: 'file', text: action });
    if (category === 'actions' || /^(triggered|started running|finished running)\b/i.test(action)) {
      return void out.push({ id, at, who, kind: 'action', text: action });
    }
    out.push({ id, at, who, kind: 'other', text: action, minor: true });
  });
  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}
