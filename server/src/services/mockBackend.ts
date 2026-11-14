/** Demo mode (MOCK_MODE): three fake customers: one Fusion, one classic (read-only) and one unavailable. */
import type { Activity, Capabilities, LicenseItem, MdrLevel, TenantKind, TenantLicenses } from '../types';
import { mdrLevel } from './licenses';
import { currentLang } from '../lang';
import type { CaseBackend } from './backend';
import { mockStore } from './mockData';
import { SophosError } from './sophosConnection';
import { LicensesOnlyApi } from './licensesOnlyApi';
import type { Counts } from './sophosClient';
import type { TenantInfo } from './registry';

/** Sample timeline for the demo "classic" customer. */
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

/** Demo licenses (Sophos product names are not translated). Dates are relative to today. */
function demoLicenses(kind: TenantKind | 'none'): TenantLicenses {
  const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const mk = (id: string, code: string, name: string, type: LicenseItem['type'], extra: Partial<LicenseItem> = {}): LicenseItem => ({
    id,
    code,
    name,
    type,
    mdr: /MTR|MDR/i.test(code + name),
    expired: false,
    ...extra,
  });
  const licenses: LicenseItem[] =
    kind === 'none'
      ? [
          mk('l1', 'CIXA', 'Sophos Endpoint - User', 'term', { quantity: 25, usage: 22, startDate: d(-200), endDate: d(530) }),
          mk('l2', 'SVRCIXA', 'Sophos Endpoint - Server', 'term', { quantity: 2, usage: 2, startDate: d(-200), endDate: d(530) }),
          mk('l3', 'EMAIL-PLUS', 'Sophos Email Plus', 'term', { quantity: 25, usage: 19, startDate: d(-340), endDate: d(25) }),
        ]
      : kind === 'fusion'
      ? [
          mk('l1', 'CIXAMTR-ADV', 'Central Intercept X Advanced with XDR and MTR Advanced', 'term', { quantity: 120, usage: 112, startDate: d(-300), endDate: d(425) }),
          mk('l2', 'SVRMTR-ADV-ADDON', 'Central MTR Advanced Add-on for Intercept X Advanced for Server with XDR', 'term', { quantity: 8, usage: 9, startDate: d(-300), endDate: d(425) }),
          mk('l3', 'EMAIL-PLUS', 'Sophos Email Plus', 'term', { quantity: 120, usage: 98, startDate: d(-640), endDate: d(60) }),
          mk('l4', 'CZTNA', 'Central Zero Trust Network', 'term', { quantity: 50, usage: 31, startDate: d(-500), endDate: d(-20), expired: true }),
        ]
      : [
          mk('l1', 'CIXAMTR-STD-MSP', 'Sophos MDR - User MSP Monthly', 'usage', { usage: 36, startDate: d(-400) }),
          mk('l2', 'SVRCIXAMTR-STD-MSP', 'Sophos MDR - Server MSP Monthly', 'usage', { usage: 4, startDate: d(-400) }),
          mk('l3', 'CFR-MSP', 'Central Firewall Reporting Advanced - MSP Monthly', 'usage', { usage: 2, startDate: d(-400) }),
          mk('l4', 'CEMA-MSP', 'Sophos Email MSP Monthly', 'usage', { usage: 36, startDate: d(-400) }),
        ];
  return { mdr: mdrLevel(licenses), licenses, source: 'rest', fetchedAt: new Date().toISOString() };
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
    // on the classic side there are no comments, AI or detection IDs for the analysis
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
  async getLicenses(): Promise<TenantLicenses> {
    return demoLicenses(this.kind);
  }
  async getCounts(): Promise<Counts> {
    const list = mockStore.list({});
    return { total: list.length, open: list.filter((c) => c.status !== 'resolved').length, actionRequired: list.filter((c) => c.status === 'actionRequired').length };
  }
}

const fusion = new MockBackend('fusion', { comments: true, classify: true, ai: true });
const classic = new MockBackend('classic', { comments: false, classify: false, ai: false });

const licensesOnly = new LicensesOnlyApi(async () => demoLicenses('none'));

const TENANTS: (TenantInfo & { api?: CaseBackend })[] = [
  { id: 'demo-a', name: 'Demo Cliente A', region: 'eu01', status: 'ok', kind: 'fusion', capabilities: fusion.capabilities, caseCount: 5, mdr: 'mdr_plus' as MdrLevel, mode: 'full', api: fusion },
  { id: 'demo-b', name: 'Demo Cliente B', region: 'eu02', status: 'ok', kind: 'classic', capabilities: classic.capabilities, caseCount: 5, mdr: 'mdr' as MdrLevel, mode: 'full', api: classic },
  { id: 'demo-c', name: 'Demo Cliente C', region: 'eu01', status: 'unavailable', reason: 'no_service' },
  { id: 'demo-d', name: 'Demo Cliente D', region: 'eu01', status: 'ok', capabilities: licensesOnly.capabilities, caseCount: 0, mdr: 'none' as MdrLevel, mode: 'licenses', api: licensesOnly },
];

const locName = (n: string) => (currentLang() === 'en' ? n.replace('Cliente', 'Customer') : n);

/** Same interface as the real registry, with fake data. */
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
      out.push(api && x.mode !== 'licenses' ? { ...t, counts: await api.getCounts() } : t);
    }
    return out;
  },
};
