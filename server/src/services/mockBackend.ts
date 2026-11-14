/** Modalità demo (MOCK_MODE): tre clienti finti: uno Fusion, uno classic (sola lettura) e uno non disponibile. */
import type { Activity, Capabilities, TenantKind } from '../types';
import { currentLang } from '../lang';
import type { CaseBackend } from './backend';
import { mockStore } from './mockData';
import { SophosError } from './sophosConnection';
import type { Counts } from './sophosClient';
import type { TenantInfo } from './registry';

/** Cronologia di esempio per il cliente "classic" della demo. */
function demoActivities(): Activity[] {
  if (currentLang() === 'en') return demoActivitiesEn();
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    { id: 'a1', at: ago(190), who: 'Auto-generated', kind: 'created', text: 'Created MdrCase ID: 934580 - Possibile ransomware' },
    { id: 'a2', at: ago(188), who: 'case handler service', kind: 'change', minor: true, changes: [{ label: 'Coda', from: 'General Queue', to: 'Automation' }] },
    { id: 'a3', at: ago(185), who: 'Automation', kind: 'status', changes: [{ label: 'Stato', from: 'Nuovo', to: 'In attesa' }, { label: 'Assegnato a', from: 'Unassigned', to: 'analyst@sophos' }] },
    { id: 'a4', at: ago(120), who: 'Elena R. (Sophos MDR)', kind: 'note', text: "Abbiamo analizzato SRV-FILE01: rileviamo cifratura attiva da parte di un processo avviato da svc-backup.\n\nStiamo verificando se ci siano altri host coinvolti.", changes: [{ label: 'Stato', from: 'In attesa', to: 'Azione in corso' }] },
    { id: 'a5', at: ago(60), who: 'Elena R. (Sophos MDR)', kind: 'action', text: 'Triggered the "Block user" action' },
    { id: 'a6', at: ago(58), who: 'Auto-generated', kind: 'status', changes: [{ label: 'Stato', from: 'Azione in corso', to: 'In attesa del cliente' }] },
  ];
}

function demoActivitiesEn(): Activity[] {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    { id: 'a1', at: ago(190), who: 'Auto-generated', kind: 'created', text: 'Created MdrCase ID: 934580 - Possible ransomware' },
    { id: 'a2', at: ago(188), who: 'case handler service', kind: 'change', minor: true, changes: [{ label: 'Queue', from: 'General Queue', to: 'Automation' }] },
    { id: 'a3', at: ago(185), who: 'Automation', kind: 'status', changes: [{ label: 'Status', from: 'New', to: 'On hold' }, { label: 'Assigned to', from: 'Unassigned', to: 'analyst@sophos' }] },
    { id: 'a4', at: ago(120), who: 'Elena R. (Sophos MDR)', kind: 'note', text: 'We analyzed SRV-FILE01: we see active encryption by a process launched by svc-backup.\n\nWe are checking whether other hosts are involved.', changes: [{ label: 'Status', from: 'On hold', to: 'Taking action' }] },
    { id: 'a5', at: ago(60), who: 'Elena R. (Sophos MDR)', kind: 'action', text: 'Triggered the "Block user" action' },
    { id: 'a6', at: ago(58), who: 'Auto-generated', kind: 'status', changes: [{ label: 'Status', from: 'Taking action', to: 'Waiting on customer' }] },
  ];
}

class MockBackend implements CaseBackend {
  constructor(
    readonly kind: TenantKind,
    readonly capabilities: Capabilities,
  ) {}
  private deny(cap: keyof Capabilities): void {
    if (!this.capabilities[cap]) throw new SophosError('not_supported_classic', 405);
  }
  async getCases(f: Parameters<CaseBackend['getCases']>[0]) {
    return mockStore.list(f);
  }
  async getCaseDetails(id: string) {
    const c = mockStore.get(id);
    // sul lato classic non ci sono commenti, AI né ID detection per l'analisi
    return c && this.kind === 'classic' ? { ...c, comments: [], detectionIds: [], activities: demoActivities() } : c;
  }
  async addCaseComment(id: string, text: string) {
    this.deny('comments');
    const c = mockStore.addComment(id, text);
    if (!c) throw new SophosError('not_found', 404);
    return c;
  }
  async getReference() {
    this.deny('classify');
    return mockStore.getReference();
  }
  async classifyCase(id: string, input: Parameters<CaseBackend['classifyCase']>[1]) {
    this.deny('classify');
    if (!mockStore.classify(id, input)) throw new SophosError('not_found', 404);
  }
  async aiCaseSummary(id: string) {
    this.deny('ai');
    const t = mockStore.aiCaseSummary(id);
    if (t === null) throw new SophosError('not_found', 404);
    return t;
  }
  async aiDetection(id: string, detectionId: string) {
    this.deny('ai');
    const t = mockStore.aiDetection(id, detectionId);
    if (t === null) throw new SophosError('not_found', 404);
    return t;
  }
  async getDashboard(days: number) {
    const d = mockStore.dashboard(days);
    return this.kind === 'classic' ? { ...d, kpi: { ...d.kpi, effortHours: null } } : d;
  }
  async getCounts(): Promise<Counts> {
    const list = mockStore.list({});
    return { total: list.length, open: list.filter((c) => c.status !== 'resolved').length, actionRequired: list.filter((c) => c.status === 'actionRequired').length };
  }
}

const fusion = new MockBackend('fusion', { comments: true, classify: true, ai: true });
const classic = new MockBackend('classic', { comments: false, classify: false, ai: false });

const TENANTS: (TenantInfo & { api?: CaseBackend })[] = [
  { id: 'demo-a', name: 'Demo Cliente A', region: 'eu01', status: 'ok', kind: 'fusion', capabilities: fusion.capabilities, caseCount: 5, api: fusion },
  { id: 'demo-b', name: 'Demo Cliente B', region: 'eu02', status: 'ok', kind: 'classic', capabilities: classic.capabilities, caseCount: 5, api: classic },
  { id: 'demo-c', name: 'Demo Cliente C', region: 'eu01', status: 'unavailable', reason: 'no_service' },
];

const locName = (n: string) => (currentLang() === 'en' ? n.replace('Cliente', 'Customer') : n);

/** Stessa interfaccia del registro reale, con dati finti. */
export const mockRegistry = {
  probing: false,
  lastRefresh: Date.now(),
  start() {},
  async refresh() {},
  list: (): TenantInfo[] => TENANTS.map(({ api: _a, ...t }) => ({ ...t, name: locName(t.name) })),
  async get(id: string) {
    return TENANTS.find((t) => t.id === id && t.status === 'ok')?.api ?? null;
  },
  async first() {
    return TENANTS[0].api ?? null;
  },
  async portfolio() {
    const out: (TenantInfo & { counts?: Counts })[] = [];
    for (const { api, ...x } of TENANTS) {
      const t = { ...x, name: locName(x.name) };
      out.push(api ? { ...t, counts: await api.getCounts() } : t);
    }
    return out;
  },
};
