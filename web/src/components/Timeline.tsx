import { useState } from 'react';
import type { Activity } from '../types';
import { fmtDateTime } from '../lib/format';
import { t } from '../lib/i18n';

const DOT: Record<Activity['kind'], string> = {
  note: 'bg-ios-blue',
  message: 'bg-ios-blue',
  status: 'bg-green-500',
  action: 'bg-orange-500',
  file: 'bg-violet-500',
  created: 'bg-neutral-400',
  change: 'bg-neutral-300 dark:bg-neutral-600',
  ai: 'bg-pink-500',
  other: 'bg-neutral-300 dark:bg-neutral-600',
};

function Changes({ a }: { a: Activity }) {
  if (!a.changes?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-500">
      {a.changes.map((c, i) => (
        <span key={i}>
          <span className="text-neutral-400">{c.label}:</span>{' '}
          {c.from && c.from !== '—' ? <>{c.from} → <b className="font-semibold text-neutral-700 dark:text-neutral-200">{c.to}</b></> : <b className="font-semibold text-neutral-700 dark:text-neutral-200">{c.to}</b>}
        </span>
      ))}
    </div>
  );
}

/**
 * Timeline of a Sophos Central (classic) case: the API has no comments, but the activity log contains
 * the analysts' notes (shown as messages) and all status changes, assignments, actions and files.
 */
export default function Timeline({ activities }: { activities: Activity[] }) {
  const [all, setAll] = useState(false);
  const shown = activities.filter((a) => all || !a.minor);
  const hidden = activities.length - activities.filter((a) => !a.minor).length;

  if (activities.length === 0) return <p className="py-4 text-center text-sm text-neutral-500">{t('Nessuna attività registrata')}</p>;

  return (
    <div>
      <ol className="space-y-3">
        {shown.map((a) =>
          a.kind === 'note' || a.kind === 'message' ? (
            <li key={a.id} className="flex flex-col items-start">
              <span className="mb-0.5 px-2 text-[11px] text-neutral-400">
                {a.who} · {fmtDateTime(a.at)}
              </span>
              <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[15px] leading-snug ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10">
                {a.text}
              </div>
              {a.changes && <div className="px-2"><Changes a={a} /></div>}
            </li>
          ) : (
            <li key={a.id} className="flex gap-2.5 px-1">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.kind]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                {a.text && <p className="break-words text-sm text-neutral-700 dark:text-neutral-200">{a.text}</p>}
                <Changes a={a} />
                <p className="mt-0.5 text-[11px] text-neutral-400">
                  {a.who} · {fmtDateTime(a.at)}
                </p>
              </div>
            </li>
          ),
        )}
      </ol>
      {hidden > 0 && (
        <button onClick={() => setAll((v) => !v)} className="mt-3 w-full rounded-xl bg-black/5 py-2 text-sm font-medium text-neutral-600 active:opacity-60 dark:bg-white/10 dark:text-neutral-300">
          {all ? t('Nascondi i dettagli tecnici') : t('Mostra anche i dettagli tecnici ({n})', { n: hidden })}
        </button>
      )}
    </div>
  );
}
