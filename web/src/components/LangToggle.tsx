import { getLang, setLang } from '../lib/i18n';

/** Piccolo selettore lingua IT/EN: mostra l'altra lingua disponibile. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const next = getLang() === 'it' ? 'en' : 'it';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={next === 'en' ? 'English' : 'Italiano'}
      className={`rounded-full px-2 py-1.5 text-xs font-bold tracking-wide text-neutral-400 active:bg-black/5 dark:active:bg-white/10 ${className}`}
    >
      {next.toUpperCase()}
    </button>
  );
}
