import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CaseList from './components/CaseList';
import CaseDetail from './components/CaseDetail';
import Licenses from './components/Licenses';
import TabBar, { Tab } from './components/TabBar';
import { TenantProvider, useTenant } from './lib/tenant';

/**
 * Hash routing: '' = dashboard (home), '#/cases' = list, '#/case/<id>' = detail.
 * Cases open with pushState: the iOS "back" swipe and the Back button return to the starting screen.
 */
type Route = { name: 'dashboard' } | { name: 'cases' } | { name: 'licenses' } | { name: 'case'; id: string };

const parseHash = (): Route => {
  const m = location.hash.match(/^#\/case\/(.+)$/);
  if (m) return { name: 'case', id: decodeURIComponent(m[1]) };
  if (location.hash === '#/licenses') return { name: 'licenses' };
  return location.hash === '#/cases' ? { name: 'cases' } : { name: 'dashboard' };
};

interface ShellProps {
  route: Route;
  mock: boolean;
  push: (hash: string) => void;
  replace: (hash: string) => void;
  onUnauthorized: () => void;
  onLogout: () => void;
}

/** Screens of the selected customer. Customers without case access (licenses only) only get the Licenses tab. */
function Shell({ route: routeIn, mock, push, replace, onUnauthorized, onLogout }: ShellProps) {
  const { licensesOnly } = useTenant();

  // licenses-only customer: force the Licenses route (Dashboard / Cases never mount, so no case API calls)
  useEffect(() => {
    if (licensesOnly && location.hash !== '#/licenses') replace('#/licenses');
  }, [licensesOnly, routeIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const route: Route = licensesOnly ? { name: 'licenses' } : routeIn;

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

  if (route.name === 'case') return <CaseDetail key={route.id} id={route.id} onBack={goBack} onUnauthorized={onUnauthorized} />;

  const tab: Tab = route.name === 'cases' ? 'cases' : route.name === 'licenses' ? 'licenses' : 'dashboard';
  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1">
        {tab === 'dashboard' ? (
          <Dashboard mock={mock} onOpenCase={openCase} onOpenList={openList} onUnauthorized={onUnauthorized} onLogout={onLogout} />
        ) : tab === 'cases' ? (
          <CaseList mock={mock} onOpen={openCase} onUnauthorized={onUnauthorized} onLogout={onLogout} />
        ) : (
          <Licenses mock={mock} onUnauthorized={onUnauthorized} onLogout={onLogout} />
        )}
      </main>
      <TabBar
        tab={tab}
        only={licensesOnly ? ['licenses'] : undefined}
        onChange={(t) => replace(t === 'cases' ? '#/cases' : t === 'licenses' ? '#/licenses' : '')}
      />
    </div>
  );
}

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

  const unauthorized = useCallback(() => setAuth('out'), []);
  const logout = async () => {
    await api.logout().catch(() => {});
    history.replaceState(null, '', location.pathname);
    setRoute({ name: 'dashboard' });
    setAuth('out');
  };

  if (auth === 'loading') return <div className="flex h-full items-center justify-center text-neutral-500">…</div>;
  if (auth === 'out') return <Login onSuccess={check} />;

  return (
    <TenantProvider onUnauthorized={unauthorized}>
      <Shell route={route} mock={mock} push={push} replace={replace} onUnauthorized={unauthorized} onLogout={logout} />
    </TenantProvider>
  );
}
