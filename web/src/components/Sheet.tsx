import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';

/** iOS-style bottom sheet: dimmed backdrop, internal scrolling, respects the safe area. */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Portal into the body: an ancestor with backdrop-filter (e.g. the blurred header) would trap the `fixed` element.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-[fade_0.2s_ease-out] bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full max-w-xl animate-[slide_0.25s_ease-out] flex-col rounded-t-3xl bg-ios-bg shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label={t('Chiudi')} className="rounded-full bg-black/5 p-1.5 text-neutral-500 active:opacity-60 dark:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
