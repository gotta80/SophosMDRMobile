import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, setApiTenant } from '../api';
import { t } from './i18n';
import type { Capabilities, TenantInfo } from '../types';

interface Ctx {
  tenants: TenantInfo[];
  probing: boolean;
  current: TenantInfo;
  caps: Capabilities;
  /** the selected customer has no case access: only the Licenses tab is shown */
  licensesOnly: boolean;
  select: (id: string) => void;
  recheck: () => Promise<void>;
}

const TenantCtx = createContext<Ctx | null>(null);
export const useTenant = () => {
  const c = useContext(TenantCtx);
  if (!c) throw new Error('TenantProvider mancante');
  return c;
};

const FULL: Capabilities = { comments: true, classify: true, ai: true };
const KEY = 'tenant';
const read = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * List of customers and selected customer (remembered on the device). While the server checks the customers
 * ("probing") the list is re-read every few seconds. Children mount only once a customer is chosen, and
 * are remounted on change (key), so every screen reloads the right customer's data.
 */
export function TenantProvider({ onUnauthorized, children }: { onUnauthorized: () => void; children: ReactNode }) {
  const [tenants, setTenants] = useState<TenantInfo[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [chosen, setChosen] = useState(read);
  const [error, setError] = useState(false);
  const timer = useRef<number>();

  const load = useCallback(async () => {
    try {
      const r = await api.tenants();
      setTenants(r.tenants);
      setProbing(r.probing);
      setError(false);
      return r.probing;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      else setError(true);
      return false;
    }
  }, [onUnauthorized]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const again = await load();
      if (alive && again) timer.current = window.setTimeout(tick, 4000);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [load]);

  const recheck = useCallback(async () => {
    await api.refreshTenants().catch(() => {});
    setProbing(true);
    window.clearTimeout(timer.current);
    const tick = async () => {
      const again = await load();
      if (again) timer.current = window.setTimeout(tick, 3000);
    };
    window.setTimeout(tick, 1200);
  }, [load]);

  const current = useMemo(() => {
    if (!tenants) return null;
    const ok = tenants.filter((t) => t.status === 'ok');
    return ok.find((t) => t.id === chosen) ?? ok[0] ?? null;
  }, [tenants, chosen]);

  // set the header right away (before the children fire their requests)
  setApiTenant(current?.id ?? '');

  const select = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
    setChosen(id);
  }, []);

  if (!tenants && !error) return <div className="flex h-full items-center justify-center text-neutral-500">{t('Caricamento clienti…')}</div>;
  if (error && !tenants)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-neutral-500">{t("Impossibile caricare l'elenco dei clienti.")}</p>
        <button className="rounded-xl bg-ios-blue px-4 py-2 font-semibold text-white" onClick={load}>{t('Riprova')}</button>
      </div>
    );
  if (!current)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="font-semibold">{probing ? t('Verifica dei clienti in corso…') : t('Nessun cliente accessibile')}</p>
        <p className="text-sm text-neutral-500">
          {probing ? t('Può richiedere qualche secondo.') : t('Controlla le credenziali Sophos o la delega dei clienti al partner.')}
        </p>
        {!probing && <button className="rounded-xl bg-ios-blue px-4 py-2 font-semibold text-white" onClick={recheck}>{t('Ricontrolla')}</button>}
      </div>
    );

  return (
    <TenantCtx.Provider value={{ tenants: tenants!, probing, current, caps: current.capabilities ?? FULL, licensesOnly: current.mode === 'licenses', select, recheck }}>
      <div key={current.id} className="contents">{children}</div>
    </TenantCtx.Provider>
  );
}
