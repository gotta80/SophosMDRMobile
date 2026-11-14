import type { CaseSeverity, CaseStatus } from '../types';
import { locale, t } from './i18n';

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('ora');
  const m = Math.floor(s / 60);
  if (m < 60) return t('{n}m fa', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{n}h fa', { n: h });
  const d = Math.floor(h / 24);
  return d < 30 ? t('{n}g fa', { n: d }) : new Date(iso).toLocaleDateString(locale());
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: t('Nuovo'),
  investigating: t('In analisi'),
  actionRequired: t('Azione richiesta'),
  onHold: t('In attesa'),
  resolved: t('Risolto'),
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

/** Etichette italiane dei verdetti primari (per nome Sophos); per gli altri si usa il titolo originale. */
const VERDICT_IT: Record<string, string> = {
  false_positive: t('Falso positivo'),
  true_positive_benign: t('Vero positivo – benigno'),
  true_positive_malicious: t('Vero positivo – malevolo'),
  inconclusive: t('Inconcludente'),
  none: t('Senza verdetto'),
};
export const verdictLabel = (v: { name: string; title: string }) => VERDICT_IT[v.name] ?? v.title;

export const VERDICT_HINT: Record<string, string> = {
  false_positive: t("L'attività rilevata non è una minaccia reale (errore di rilevamento)."),
  true_positive_benign: t("L'attività è reale ma legittima o autorizzata."),
  true_positive_malicious: t("L'attività è reale e malevola: minaccia confermata."),
  inconclusive: t('Non ci sono dati sufficienti per decidere.'),
};

/** Colori dei verdetti nei grafici (barre) e nei chip. */
export const VERDICT_BAR: Record<string, string> = {
  false_positive: 'bg-slate-400',
  true_positive_benign: 'bg-emerald-500',
  true_positive_malicious: 'bg-red-500',
  inconclusive: 'bg-amber-400',
  none: 'bg-neutral-300 dark:bg-neutral-600',
};
export const VERDICT_CHIP: Record<string, string> = {
  false_positive: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  true_positive_benign: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  true_positive_malicious: 'bg-red-500/15 text-red-600 dark:text-red-400',
  inconclusive: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
};
