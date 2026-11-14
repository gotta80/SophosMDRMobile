import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { t } from '../lib/i18n';
import LangToggle from './LangToggle';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.login(pin);
      onSuccess();
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 429 ? t('Troppi tentativi. Riprova tra {n} min.', { n: Math.ceil((e2.retryAfter ?? 900) / 60) }) : t('PIN non valido'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-8 pt-safe pb-safe">
      <LangToggle className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))]" />
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[22px] bg-ios-blue text-white shadow-lg">
        <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z" /></svg>
      </div>
      <h1 className="mb-1 text-2xl font-bold">Sophos MDR</h1>
      <p className="mb-8 text-sm text-neutral-500">{t('Inserisci il PIN di accesso')}</p>
      <form onSubmit={submit} className="w-full max-w-xs">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full rounded-xl bg-white px-4 py-3 text-center text-xl tracking-[0.4em] outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-ios-blue dark:bg-neutral-900 dark:ring-white/10"
        />
        <p className="mt-3 h-5 text-center text-sm text-red-500" role="alert">{error}</p>
        <button
          disabled={busy || !pin}
          className="mt-2 w-full rounded-xl bg-ios-blue py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? t('Verifica…') : t('Accedi')}
        </button>
      </form>
    </main>
  );
}
