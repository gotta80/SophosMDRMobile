import type { CaseSummary } from '../types';
import { SEVERITY_BAR, VERDICT_CHIP, timeAgo, verdictLabel } from '../lib/format';
import { SeverityBadge, StatusText } from './Badges';

/** Card compatta di un caso (lista e dashboard). */
export default function CaseCard({ c, onOpen }: { c: CaseSummary; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(c.id)}
      className="relative w-full overflow-hidden rounded-2xl bg-white p-3.5 pl-4 text-left shadow-sm ring-1 ring-black/5 transition active:scale-[0.99] active:opacity-80 dark:bg-neutral-900 dark:ring-white/10"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_BAR[c.severity]}`} />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={c.severity} />
          <StatusText status={c.status} />
        </div>
        <span className="text-xs text-neutral-400">{timeAgo(c.updatedAt)}</span>
      </div>
      <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">{c.title}</h2>
      <div className="mt-1 flex items-center justify-between gap-2">
        {c.primaryEntity ? (
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-neutral-500">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
            {c.primaryEntity}
          </p>
        ) : (
          <p className="truncate text-xs text-neutral-500">{c.shortId ? `#${c.shortId} · ` : ''}{c.type}</p>
        )}
        {c.verdict && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_CHIP[c.verdict.name] ?? 'bg-black/5'}`}>
            {verdictLabel(c.verdict)}
          </span>
        )}
      </div>
    </button>
  );
}
