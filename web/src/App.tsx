import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CaseList from './components/CaseList';
import CaseDetail from './components/CaseDetail';
import TabBar, { Tab } from './components/TabBar';

/**
 * Routing a hash: '' = dashboard (home), '#/cases' = lista, '#/case/<id>' = dettaglio.
 * I casi si aprono con pushState: lo swipe "indietro" di iOS e il tasto Indietro tornano alla schermata di partenza.
 */
type Route = { name: 'dashboard' } | { name: 'cases' } | { name: 'case'; id: string };

const parseHash = (): Route => {
  const m = location.hash.match(/^#\/case\/(.+)$/);
  if (m) return { name: 'case', id: decodeURIComponent(m[1]) };
  return location.hash === '#/cases' ? { name: 'cases' } : { name: 'dashboard' };
};

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  const [mock, setMock] = useState(false);
  const [route, setRoute] = useState<Route>(parseHash());

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
    const sync = () => setRoute(parseHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [check]);

  /** Naviga in avanti (nuova voce di cronologia, segnata come interna). */
  const push = (hash: string) => {
    history.pushState({ inApp: true }, '', hash || location.pathname);
    setRoute(parseHash());
  };
  /** Cambio scheda: sostituisce la voce corrente (nessuna cronologia accumulata). */
  const replace = (hash: string) => {
    history.replaceState(history.state, '', hash || location.pathname);
    setRoute(parseHash());
  };

  const openCase = (id: string) => push(`#/case/${encodeURIComponent(id)}`);
  const openList = (filter: 'all' | 'action' | 'active' | 'resolved') => {
    try {
      sessionStorage.setItem('filter', filter);
    } catch {
      /* ignora */
    }
    replace('#/cases');
  };

  const goBack = () => {
    if (history.state?.inApp) history.back(); // popstate aggiorna la route
    else replace('#/cases'); // aperto direttamente sul caso (ricarica / Home screen)
  };

  const unauthorized = useCallback(() => setAuth('out'), []);
  const logout = async () => {
    await api.logout().catch(() => {});
    history.replaceState(null, '', location.pathname);
    setRoute({ name: 'dashboard' });
    setAuth('out');
  };

  if (auth === 'loading') return <div className="flex min-h-[100dvh] items-center justify-center text-neutral-500">…</div>;
  if (auth === 'out') return <Login onSuccess={check} />;

  if (route.name === 'case') {
    return <CaseDetail key={route.id} id={route.id} onBack={goBack} onUnauthorized={unauthorized} />;
  }

  const tab: Tab = route.name === 'cases' ? 'cases' : 'dashboard';
  return (
    <div className="flex h-[100dvh] flex-col">
      <main className="min-h-0 flex-1">
        {tab === 'dashboard' ? (
          <Dashboard mock={mock} onOpenCase={openCase} onOpenList={openList} onUnauthorized={unauthorized} onLogout={logout} />
        ) : (
          <CaseList mock={mock} onOpen={openCase} onUnauthorized={unauthorized} onLogout={logout} />
        )}
      </main>
      <TabBar tab={tab} onChange={(t) => replace(t === 'cases' ? '#/cases' : '')} />
    </div>
  );
}
