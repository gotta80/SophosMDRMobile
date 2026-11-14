import { getLang, setLang } from '../lib/i18n';

/** Selettore lingua EN | IT: la lingua attiva è evidenziata, un tap passa all'altra. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const cur = getLang();
  const next = cur === 'it' ? 'en' : 'it';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={next === 'en' ? 'Switch to English' : 'Passa a Italiano'}
      className={`rounded-full px-2 py-1.5 text-xs font-bold tracking-wide active:bg-black/5 dark:active:bg-white/10 ${className}`}
    >
      <span className={cur === 'en' ? 'text-ios-blue' : 'text-neutral-400'}>EN</span>
      <span className="px-0.5 text-neutral-300 dark:text-neutral-600">|</span>
      <span className={cur === 'it' ? 'text-ios-blue' : 'text-neutral-400'}>IT</span>
    </button>
  );
}
