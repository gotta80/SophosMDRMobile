import type { CaseSeverity, CaseStatus } from '../types';

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}g fa` : new Date(iso).toLocaleDateString('it-IT');
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'Nuovo',
  investigating: 'In analisi',
  actionRequired: 'Azione richiesta',
  onHold: 'In attesa',
  resolved: 'Risolto',
};

export const SEVERITY_LABEL: Record<CaseSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SEVERITY_CLASS: Record<CaseSeverity, string> = {
  critical: 'bg-red-500/15 text-red-600 dark:text-red-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  low: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
};

export const SEVERITY_BAR: Record<CaseSeverity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-400',
  low: 'bg-sky-400',
};

export const STATUS_CLASS: Record<CaseStatus, string> = {
  new: 'text-ios-blue',
  investigating: 'text-neutral-500 dark:text-neutral-400',
  actionRequired: 'text-red-600 dark:text-red-400 font-semibold',
  onHold: 'text-neutral-500 dark:text-neutral-400',
  resolved: 'text-green-600 dark:text-green-400',
};
