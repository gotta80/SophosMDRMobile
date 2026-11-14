import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CaseList from './components/CaseList';
import CaseDetail from './components/CaseDetail';
import TabBar, { Tab } from './components/TabBar';
import { TenantProvider } from './lib/tenant';

/**
 * Hash routing: '' = dashboard (home), '#/cases' = list, '#/case/<id>' = detail.
 * Cases open with pushState: the iOS "back" swipe and the Back button return to the starting screen.
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

  /** Navigates forward (new history entry, marked as internal). */
  const push = (hash: string) => {
    history.pushState({ inApp: true }, '', hash || location.pathname);
    setRoute(parseHash());
  };
  /** Tab change: replaces the current entry (no history accumulated). */
  const replace = (hash: string) => {
    history.replaceState(history.state, '', hash || location.pathname);
    setRoute(parseHash());
  };

  const openCase = (id: string) => push(`#/case/${encodeURIComponent(id)}`);
  const openList = (filter: 'all' | 'action' | 'active' | 'resolved') => {
    try {
      sessionStorage.setItem('filter', filter);
    } catch {
      /* ignore */
    }
    replace('#/cases');
  };

  const goBack = () => {
    if (history.state?.inApp) history.back(); // popstate updates the route
    else replace('#/cases'); // opened directly on the case (reload / Home screen)
  };

  const unauthorized = useCallback(() => setAuth('out'), []);
  const logout = async () => {
    await api.logout().catch(() => {});
    history.replaceState(null, '', location.pathname);
    setRoute({ name: 'dashboard' });
    setAuth('out');
  };

  if (auth === 'loading') return <div className="flex h-full items-center justify-center text-neutral-500">…</div>;
  if (auth === 'out') return <Login onSuccess={check} />;

  const tab: Tab = route.name === 'cases' ? 'cases' : 'dashboard';
  return (
    <TenantProvider onUnauthorized={unauthorized}>
      {route.name === 'case' ? (
        <CaseDetail key={route.id} id={route.id} onBack={goBack} onUnauthorized={unauthorized} />
      ) : (
        <div className="flex h-full flex-col">
          <main className="min-h-0 flex-1">
            {tab === 'dashboard' ? (
              <Dashboard mock={mock} onOpenCase={openCase} onOpenList={openList} onUnauthorized={unauthorized} onLogout={logout} />
            ) : (
              <CaseList mock={mock} onOpen={openCase} onUnauthorized={unauthorized} onLogout={logout} />
            )}
          </main>
          <TabBar tab={tab} onChange={(t) => replace(t === 'cases' ? '#/cases' : '')} />
        </div>
      )}
    </TenantProvider>
  );
}
