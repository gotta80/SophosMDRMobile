import { EN_DICT } from './en';

export type Lang = 'it' | 'en';

const KEY = 'lang';

function detect(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'it' || q === 'en') {
      try { localStorage.setItem(KEY, q); } catch { /* ignora */ }
      return q;
    }
  } catch { /* ignora */ }
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'it' || s === 'en') return s;
  } catch { /* ignora */ }
  return typeof navigator !== 'undefined' && /^it/i.test(navigator.language || '') ? 'it' : 'en';
}

const lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = (): Lang => lang;
export const locale = () => (lang === 'it' ? 'it-IT' : 'en-GB');

/** Cambia lingua (salvata sul dispositivo) e ricarica la pagina. */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* ignora */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.replace(u.toString());
}

/** Dizionario: chiave = testo italiano, valore = inglese (lib/en.ts). */
const EN: Record<string, string> = EN_DICT;

/** Traduce il testo italiano (sorgente). Supporta i segnaposto {nome}. */
export function t(it: string, vars?: Record<string, string | number>): string {
  let s = it;
  if (lang === 'en') {
    s = EN[it] ?? it;
    if (EN[it] === undefined && import.meta.env?.DEV) console.warn('[i18n] manca la traduzione:', it);
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
