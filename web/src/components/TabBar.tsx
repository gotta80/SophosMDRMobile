import { t } from '../lib/i18n';

export type Tab = 'dashboard' | 'cases';

const Icon = ({ tab }: { tab: Tab }) =>
  tab === 'dashboard' ? (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
  );

/** Bottom navigation bar (Dashboard / Cases), with safe area for the home indicator. */
export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'cases', label: t('Casi') },
  ];
  return (
    <nav className="z-20 flex border-t border-black/5 bg-ios-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-white/10" aria-label={t('Navigazione principale')}>
      {items.map((i) => (
        <button
          key={i.key}
          onClick={() => onChange(i.key)}
          aria-current={tab === i.key ? 'page' : undefined}
          className={`flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium transition active:opacity-60 ${
            tab === i.key ? 'text-ios-blue' : 'text-neutral-400'
          }`}
        >
          <Icon tab={i.key} />
          {i.label}
        </button>
      ))}
    </nav>
  );
}
