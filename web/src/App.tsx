import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import CaseList from './components/CaseList';
import CaseDetail from './components/CaseDetail';

/** Routing a hash (#/case/<id>). Lo swipe "indietro" di iOS funziona perché apriamo i casi con pushState. */
const parseHash = () => {
  const m = location.hash.match(/^#\/case\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  const [mock, setMock] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(parseHash());

  const check = useCallback(async () => {
    try {
      const s = await api.session();
      setMock(s.mock);
      setAuth(s.authenticated ? 'in' : 'out');
    } catch {
      setAuth('out');
    }
  }, []);

  useEffect(() => {
    check();
    const sync = () => setCaseId(parseHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [check]);

  const openCase = (id: string) => {
    // marca l'entry come "navigazione interna": il pulsante Indietro può usare history.back()
    history.pushState({ inApp: true }, '', `#/case/${encodeURIComponent(id)}`);
    setCaseId(id);
  };

  const goBack = () => {
    if (history.state?.inApp) {
      history.back(); // popstate aggiorna caseId
    } else {
      // aperto direttamente sul caso (ricarica / Home screen): sostituisce l'entry con la lista
      history.replaceState(null, '', location.pathname);
      setCaseId(null);
    }
  };

  const unauthorized = useCallback(() => setAuth('out'), []);
  const logout = async () => {
    await api.logout().catch(() => {});
    history.replaceState(null, '', location.pathname);
    setCaseId(null);
    setAuth('out');
  };

  if (auth === 'loading') return <div className="flex min-h-[100dvh] items-center justify-center text-neutral-500">…</div>;
  if (auth === 'out') return <Login onSuccess={check} />;
  if (caseId) return <CaseDetail key={caseId} id={caseId} onBack={goBack} onUnauthorized={unauthorized} />;
  return <CaseList mock={mock} onOpen={openCase} onUnauthorized={unauthorized} onLogout={logout} />;
}
