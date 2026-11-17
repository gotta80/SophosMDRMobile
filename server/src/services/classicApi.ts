import { decode } from './htmlText';
import { currentLang } from '../lang';
/**
 * Adapter for the cases on the Sophos Central "classic dashboard" (REST /cases/v1), for customers not yet
 * migrated to Fusion. READ-ONLY: the REST API has no comments, verdict or AI (verified on a real tenant).
 * Endpoints used: GET /cases, /cases/{id}, /cases/{id}/detections, /impacted-entities, /mitre-attack-summary.
 */
import { parseActivities } from './classicActivities';
import type {
  Activity,
  CaseComment,
  CaseDetails,
  CaseFilters,
  CaseSeverity,
  CaseStatus,
  CaseSummary,
  ClassifyInput,
  DashboardData,
  Detection,
  Entity,
  MitreTechnique,
  Ref,
  Reference,
} from '../types';
import type { CaseBackend } from './backend';
import { Connection, SophosError } from './sophosConnection';
import { LicenseStore, fetchLicenses } from './licenses';
import type { Counts } from './sophosClient';

type Raw = Record<string, any>;

const MAX_PAGES = 6; // up to 300 cases (50 per page)
const MAX_ENRICHED = 15;
const CACHE_MS = 10 * 60_000;

const STATUS: Record<string, CaseStatus> = {
  new: 'new',
  investigating: 'investigating',
  actionRequired: 'actionRequired',
  onHold: 'onHold',
  resolved: 'resolved',
};

function severity(s: unknown): CaseSeverity {
  return s === 'critical' || s === 'high' || s === 'medium' ? s : 'low'; // low / informational / notSet
}

/** Detection: numeric severity 1-10 -> app levels. */
function detSeverity(n: unknown): CaseSeverity {
  const v = Number(n);
  return v >= 9 ? 'critical' : v >= 7 ? 'high' : v >= 4 ? 'medium' : 'low';
}

const VERDICTS: Record<string, Ref> = {
  falsePositive: { id: 'falsePositive', name: 'false_positive', title: 'False Positive' },
  truePositiveMalicious: { id: 'truePositiveMalicious', name: 'true_positive_malicious', title: 'True Positive - Malicious' },
  truePositiveBenign: { id: 'truePositiveBenign', name: 'true_positive_benign', title: 'True Positive - Benign' },
  truePositive: { id: 'truePositive', name: 'true_positive', title: 'True Positive' },
  inconclusive: { id: 'inconclusive', name: 'inconclusive', title: 'Inconclusive' },
};

const titleCase = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export class ClassicApi implements CaseBackend {
  readonly kind = 'classic' as const;
  readonly capabilities = { comments: false, classify: false, ai: false };

  constructor(
    private readonly conn: Connection,
    readonly tenantId: string,
    private readonly apiHost: string,
  ) {}

  private licenses = new LicenseStore(() => fetchLicenses(this.conn, this.tenantId, false));
  getLicenses(force = false) {
    return this.licenses.get(force);
  }

  private get<T>(path: string) {
    return this.conn.rest<T>(this.apiHost, this.tenantId, `/cases/v1${path}`);
  }

  private escalated = new Map<string, boolean>();
  private entityCache = new Map<string, { at: number; entities: Entity[] }>();

  private toSummary(c: Raw): CaseSummary {
    this.escalated.set(String(c.id), !!c.escalated);
    return {
      id: String(c.id),
      shortId: String(c.id),
      title: decode(String(c.name ?? 'Senza titolo')),
      severity: severity(c.severity),
      status: STATUS[c.status] ?? 'new',
      type: c.type ? titleCase(String(c.type)) : 'Case',
      managedBy: c.managedBy === 'sophos' ? 'Sophos MDR' : c.managedBy === 'self' ? 'Cliente' : String(c.managedBy ?? 'Sophos MDR'),
      primaryEntity: null,
      verdict: c.verdict ? (VERDICTS[c.verdict] ?? { id: String(c.verdict), name: String(c.verdict), title: titleCase(String(c.verdict)) }) : null,
      secondaryVerdict: null,
      createdAt: String(c.createdAt ?? c.updatedAt),
      updatedAt: String(c.updatedAt ?? c.createdAt),
    };
  }

  private async entities(caseId: string): Promise<Entity[]> {
    const hit = this.entityCache.get(caseId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.entities;
    const r = await this.get<{ items?: Raw[] }>(`/cases/${encodeURIComponent(caseId)}/impacted-entities`);
    const out: Entity[] = [];
    for (const e of r.items ?? []) {
      const t = String(e.type ?? '').toLowerCase();
      if (t === 'device' || t === 'endpoint' || t === 'host') {
        out.push({ id: String(e.id), type: 'host', name: String(e.entityAttributes?.hostname ?? e.name), detail: e.entityAttributes?.os_platform ? String(e.entityAttributes.os_platform) : undefined });
      } else if (t === 'user' || t === 'account') {
        out.push({ id: String(e.id), type: 'user', name: String(e.name) });
      } else if (e.name) {
        out.push({ id: String(e.id), type: 'other', name: String(e.name) });
      }
    }
    this.entityCache.set(caseId, { at: Date.now(), entities: out });
    return out;
  }

  // ---------------------------------------------------------------- read
  async getCases(filters: CaseFilters): Promise<CaseSummary[]> {
    const all: CaseSummary[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await this.get<{ items?: Raw[]; pages?: { total?: number } }>(`/cases?pageSize=50&page=${page}&pageTotal=true&sort=updatedAt:desc`);
      all.push(...(r.items ?? []).map((c) => this.toSummary(c)));
      if (page >= (r.pages?.total ?? 1)) break;
    }
    const result = all
      .filter((c) => !filters.statuses?.length || filters.statuses.includes(c.status))
      .filter((c) => !filters.severities?.length || filters.severities.includes(c.severity))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    // main host on the open-case cards (best effort)
    for (const c of result.filter((x) => x.status !== 'resolved').slice(0, MAX_ENRICHED)) {
      try {
        c.primaryEntity = (await this.entities(c.id)).find((e) => e.type === 'host')?.name ?? null;
      } catch {
        /* ignore */
      }
    }
    return result;
  }

  async getCaseDetails(caseId: string): Promise<CaseDetails | null> {
    let c: Raw;
    try {
      c = await this.get<Raw>(`/cases/${encodeURIComponent(caseId)}`);
    } catch (e) {
      if (e instanceof SophosError && e.status === 404) return null;
      throw e;
    }
    const id = encodeURIComponent(caseId);
    // sequential: the Sophos API does not like many parallel requests
    const det = await this.get<{ items?: Raw[] }>(`/cases/${id}/detections`).catch(() => ({ items: [] as Raw[] }));
    const mitre = await this.get<{ tactics?: Raw[] }>(`/cases/${id}/mitre-attack-summary`).catch(() => ({ tactics: [] as Raw[] }));
    const entities = await this.entities(caseId).catch(() => [] as Entity[]);
    const activities = await this.activities(caseId).catch(() => []);

    const detections: Detection[] = (det.items ?? []).map((d) => ({
      id: String(d.id),
      name: String(d.detectionRule ?? d.attackType ?? d.id),
      severity: d.severity != null ? detSeverity(d.severity) : null,
      source: d.sensor?.type ? String(d.sensor.type) : undefined,
    }));
    const techniques: MitreTechnique[] = [];
    for (const t of mitre.tactics ?? []) {
      for (const q of t.techniques ?? []) techniques.push({ id: String(q.id), name: String(q.name ?? ''), tactic: String(t.name ?? '') });
    }
    const sum = this.toSummary(c);
    return {
      ...sum,
      summary: `${c.detectionCount ?? detections.length} detection · case su Sophos Central (classic)${c.escalated ? ' · escalation' : ''}`,
      keyFindings: c.overview ? String(c.overview) : undefined,
      detectionIds: [],
      entities,
      detections,
      mitre: techniques,
      comments: [],
      activities,
    };
  }

  /** Case activity log (undocumented but verified endpoint): analyst notes, statuses, actions, files. */
  private async activities(caseId: string): Promise<Activity[]> {
    const rows: Raw[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await this.get<{ items?: Raw[]; pages?: { total?: number } }>(`/cases/${encodeURIComponent(caseId)}/activities?pageSize=50&page=${page}`);
      rows.push(...(r.items ?? []));
      if (page >= (r.pages?.total ?? 1)) break;
    }
    return parseActivities(rows);
  }

  // ---------------------------------------------------------------- not available on the classic side
  private unsupported(): never {
    throw new SophosError('not_supported_classic', 405);
  }
  addCaseComment(_id: string, _text: string): Promise<CaseComment> {
    return this.unsupported();
  }
  getReference(): Promise<Reference> {
    return this.unsupported();
  }
  classifyCase(_id: string, _i: ClassifyInput): Promise<void> {
    return this.unsupported();
  }
  aiCaseSummary(_id: string): Promise<string> {
    return this.unsupported();
  }
  aiDetection(_id: string, _d: string): Promise<string> {
    return this.unsupported();
  }

  // ---------------------------------------------------------------- metrics computed from the cases
  private countsCache: { at: number; data: Counts } | null = null;
  async getCounts(): Promise<Counts> {
    if (this.countsCache && Date.now() - this.countsCache.at < 2 * 60_000) return this.countsCache.data;
    const r = await this.get<{ items?: Raw[] }>('/cases?pageSize=50&sort=updatedAt:desc');
    const items = r.items ?? [];
    const data: Counts = {
      total: items.length,
      open: items.filter((c) => c.status !== 'resolved').length,
      actionRequired: items.filter((c) => c.status === 'actionRequired').length,
    };
    this.countsCache = { at: Date.now(), data };
    return data;
  }

  async getDashboard(days: number): Promise<DashboardData> {
    const cases = await this.getCases({});
    const to = Date.now();
    const since = to - days * 86_400_000;
    const inPeriod = cases.filter((c) => +new Date(c.createdAt) >= since);

    const bin = days > 31 ? 7 : 1;
    const nBins = Math.ceil(days / bin);
    const daily = Array.from({ length: nBins }, (_, i) => ({ date: new Date(to - (nBins - i) * bin * 86_400_000).toISOString().slice(0, 10), count: 0 }));
    for (const c of inPeriod) {
      const idx = Math.min(nBins - 1, Math.max(0, Math.floor((+new Date(c.createdAt) - (to - nBins * bin * 86_400_000)) / (bin * 86_400_000))));
      daily[idx].count++;
    }
    const verdicts = new Map<string, { title: string; name: string; count: number }>();
    for (const c of inPeriod) {
      const v = c.verdict ?? { name: 'none', title: currentLang() === 'en' ? 'No verdict' : 'Senza verdetto' };
      verdicts.set(v.name, { title: v.title, name: v.name, count: (verdicts.get(v.name)?.count ?? 0) + 1 });
    }
    const count = <T>(f: (c: CaseSummary) => T, keys: T[]) => keys.map((key) => ({ key, count: inPeriod.filter((c) => f(c) === key).length }));
    return {
      days,
      generatedAt: new Date().toISOString(),
      kpi: {
        totalCases: inPeriod.length,
        actionRequiredCases: cases.filter((c) => c.status === 'actionRequired').length,
        effortHours: null,
        escalatedCases: inPeriod.filter((c) => this.escalated.get(c.id)).length,
        weekendCases: inPeriod.filter((c) => [0, 6].includes(new Date(c.createdAt).getUTCDay())).length,
        openCases: cases.filter((c) => c.status !== 'resolved').length,
      },
      bySeverity: count((c) => c.severity, ['critical', 'high', 'medium', 'low'] as CaseSeverity[]),
      byVerdict: [...verdicts.values()].sort((a, b) => b.count - a.count),
      byStatus: count((c) => c.status, ['actionRequired', 'new', 'investigating', 'onHold', 'resolved'] as CaseStatus[]),
      daily,
      attention: cases.filter((c) => c.status === 'actionRequired').slice(0, 5),
    };
  }
}
