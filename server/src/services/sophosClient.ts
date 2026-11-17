import { currentLang } from '../lang';
/**
 * Sophos client.
 *  1. POST id.sophos.com/api/v2/oauth2/token  (client_credentials, scope=token) -> JWT, cached in memory
 *  2. GET  api.central.sophos.com/whoami/v1    -> id and idType (tenant | organization | partner | distributor)
 *  3. POST api.taegis.sophos.com/graphql       -> Cases GraphQL (Authorization + X-Tenant-ID)
 * Secrets and tokens stay in the backend only.
 */
import { config } from '../config';
import { Connection, SophosError } from './sophosConnection';
import { LicenseStore, fetchLicenses } from './licenses';
import type { CaseBackend } from './backend';
import type {
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
import {
  M_ADD_COMMENT,
  M_UPDATE_CASE,
  Q_AGGREGATION,
  Q_AI_CASE_SUMMARY,
  Q_AI_DETECTION,
  Q_METRICS,
  Q_REFERENCE_SECONDARY_VERDICTS,
  Q_REFERENCE_STATUSES,
  Q_REFERENCE_VERDICTS,
  toSeverity,
  Q_CASES,
  Q_ASSET,
  Q_DETECTIONS,
  parseAlerts,
  Q_CASE,
  Q_CASE_COMMENTS,
  Q_CASE_EVIDENCE,
  assetToEntities,
  assetVariables,
  evidenceVariables,
  casesVariables,
  caseVariables,
  commentsVariables,
  learnAuthors,
  normalizeComment,
  normalizeDetails,
  normalizeSummary,
} from './sophosQueries';

import { decode, htmlToMarkdown } from './htmlText';
import { fetchAccountHealth, HealthStore } from './accountHealth';

/** AI text may carry HTML entities (&amp;) or tags: decode them, plain Markdown is left as is. */
const cleanAiText = (s: string) => (/<[a-z\/]/i.test(s) ? htmlToMarkdown(s) : decode(s));

const MAX_PAGES = 3; // up to 300 cases
const ENTITY_TTL_MS = 10 * 60_000;
const MAX_DETECTIONS = 20; // detections fetched per case
const REF_TTL_MS = 60 * 60_000; // reference data and AI answers
const DASH_TTL_MS = 60_000;
const MAX_ASSETS = 10; // assets resolved per case
const MAX_ENRICHED = 25; // open cases enriched with the host in the list

export interface Counts {
  total: number;
  open: number;
  actionRequired: number;
}

interface Evidence {
  entities: Entity[];
  detectionIds: string[];
  detections: Detection[];
  mitre: MitreTechnique[];
}

export { SophosError };

/** API of a single customer (tenant), reached through a connection. Caches are per tenant. */
export class TenantApi implements CaseBackend {
  readonly kind = 'fusion' as const;
  readonly capabilities = { comments: true, classify: true, ai: true };

  constructor(
    private readonly conn: Connection,
    readonly tenantId: string,
    private readonly apiHost?: string,
  ) {}

  private licenses = new LicenseStore(() => fetchLicenses(this.conn, this.tenantId, true));
  getLicenses(force = false) {
    return this.licenses.get(force);
  }

  private health = new HealthStore(() => {
    if (!this.apiHost) throw new SophosError('not_found', 404);
    return fetchAccountHealth(this.conn, this.apiHost, this.tenantId);
  });
  getAccountHealth(force = false) {
    return this.health.get(force);
  }

  /** Author ID of the comments written by this app (to tell them apart from the analysts' ones). */
  /** Authors recognised as colleagues (customer side) / as Sophos SOC, learned from the comments read so far (in memory). */
  private readonly colleagues = new Set<string>();
  private readonly soc = new Set<string>();

  private myAuthorIds(): Set<string> {
    return new Set([this.conn.clientId, ...config.sophos.myAuthorIds].filter(Boolean));
  }

  private graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.conn.graphql<T>(this.tenantId, query, variables);
  }
  // ---------------------------------------------------------------- entities (hosts / users)
  private evidenceCache = new Map<string, { at: number } & Evidence>();
  /** If the credential lacks Agent:read the assets cannot be resolved: do not retry for an hour. */
  private assetsDeniedUntil = 0;

  /**
   * Case evidence (10 min cache): detections (title, severity, MITRE), hosts and users.
   * Main source: detection alerts (Alert:read). Assets (Agent:read) enrich with the isolation
   * status, if the role allows it. Every step is best-effort. Calls in sequence.
   */
  private async getEvidence(caseId: string): Promise<Evidence> {
    const hit = this.evidenceCache.get(caseId);
    if (hit && Date.now() - hit.at < ENTITY_TTL_MS) return hit;

    const ev = await this.graphql<{
      caseEvidence: { assetsEvidence?: { assetId: string }[]; detectionsEvidence?: { detectionId: string }[] };
    }>(Q_CASE_EVIDENCE, evidenceVariables(caseId));
    const detectionIds = (ev.caseEvidence?.detectionsEvidence ?? []).map((d) => d.detectionId);

    let parsed: ReturnType<typeof parseAlerts> = { detections: [], mitre: [], entities: [] };
    if (detectionIds.length) {
      try {
        const r = await this.graphql<{ detectionRetrieveById: { alerts?: { list?: any[] } } }>(Q_DETECTIONS, {
          ids: detectionIds.slice(0, MAX_DETECTIONS),
        });
        parsed = parseAlerts(r.detectionRetrieveById?.alerts?.list ?? []);
      } catch {
        /* detections unavailable: only the IDs are shown */
      }
    }

    // Isolation status (and host for cases without detections) from the assets, only if the role has Agent:read
    const entities = [...parsed.entities];
    if (Date.now() >= this.assetsDeniedUntil) {
      try {
        for (const { assetId } of (ev.caseEvidence?.assetsEvidence ?? []).slice(0, MAX_ASSETS)) {
          const r = await this.graphql<{ assetsV2: { assets: any[] } }>(Q_ASSET, assetVariables(assetId));
          for (const e of r.assetsV2?.assets?.flatMap(assetToEntities) ?? []) {
            const same = entities.find((x) => x.type === e.type && x.name.toLowerCase().split('\\').pop() === e.name.toLowerCase().split('\\').pop());
            if (same) same.detail = e.detail ?? same.detail;
            else entities.push(e);
          }
        }
      } catch (e) {
        if (e instanceof SophosError && e.status === 403) this.assetsDeniedUntil = Date.now() + REF_TTL_MS;
      }
    }

    const entry = { at: Date.now(), entities, detectionIds, detections: parsed.detections, mitre: parsed.mitre };
    this.evidenceCache.set(caseId, entry);
    return entry;
  }
  private getEntities = async (caseId: string) => (await this.getEvidence(caseId)).entities;

  // ---------------------------------------------------------------- reference data (1 h cache)
  private refCache: { at: number; data: Reference } | null = null;
  private statuses: { id: string; name: string; isClosed: boolean }[] = [];

  async getReference(): Promise<Reference> {
    if (this.refCache && Date.now() - this.refCache.at < REF_TTL_MS) return this.refCache.data;
    const st = await this.graphql<{ casePrimaryStatuses: { primaryStatuses: any[] } }>(Q_REFERENCE_STATUSES, {});
    this.statuses = st.casePrimaryStatuses?.primaryStatuses ?? [];
    const v = await this.graphql<{ casePrimaryVerdicts: { primaryVerdicts: any[] } }>(Q_REFERENCE_VERDICTS, {});
    const sv = await this.graphql<{ caseSecondaryVerdicts: { secondaryVerdicts: any[] } }>(Q_REFERENCE_SECONDARY_VERDICTS, {});
    const ref = (r: any): Ref => ({ id: String(r.id), name: String(r.name), title: String(r.title ?? r.name) });
    const data: Reference = {
      verdicts: (v.casePrimaryVerdicts?.primaryVerdicts ?? []).map(ref),
      secondaryVerdicts: (sv.caseSecondaryVerdicts?.secondaryVerdicts ?? []).map(ref),
      closedStatusId: st.casePrimaryStatuses?.primaryStatuses?.find((s) => s.isClosed)?.id ?? null,
    };
    this.refCache = { at: Date.now(), data };
    return data;
  }

  // ---------------------------------------------------------------- case classification / closing
  /**
   * Sets the verdict (e.g. False Positive) and, if `close`, closes the case. A single updateCase (PATCH semantics).
   * Verdict/reason compatibility and closing requirements are validated by Sophos: the error is reported to the user.
   */
  async classifyCase(caseId: string, input: ClassifyInput): Promise<void> {
    const ref = await this.getReference();
    if (!ref.verdicts.some((v) => v.id === input.verdictId)) throw new SophosError('verdict_invalid', 400);
    if (input.secondaryVerdictId && !ref.secondaryVerdicts.some((v) => v.id === input.secondaryVerdictId))
      throw new SophosError('secondary_verdict_invalid', 400);
    if (input.close && !ref.closedStatusId) throw new SophosError('closed_status_unknown', 500);
    const payload: Record<string, unknown> = {
      id: caseId,
      primaryVerdictId: input.verdictId,
      ...(input.secondaryVerdictId ? { secondaryVerdictId: input.secondaryVerdictId } : {}),
      ...(input.closeReason ? { closeReason: input.closeReason } : {}),
      ...(input.close ? { primaryStatusId: ref.closedStatusId } : {}),
    };
    await this.graphql(M_UPDATE_CASE, { input: payload });
    this.dashCache.clear();
  }

  // ---------------------------------------------------------------- AI explanations (1 h cache: ~15 s each)
  private aiCache = new Map<string, { at: number; text: string }>();

  private async cachedAi(key: string, fn: () => Promise<string>): Promise<string> {
    const hit = this.aiCache.get(key);
    if (hit && Date.now() - hit.at < REF_TTL_MS) return hit.text;
    const text = await fn();
    this.aiCache.set(key, { at: Date.now(), text });
    return text;
  }

  aiCaseSummary(caseId: string): Promise<string> {
    return this.cachedAi(`case:${caseId}`, async () => {
      const r = await this.graphql<{ generativeAICaseSummary: { summary: string } }>(Q_AI_CASE_SUMMARY, { caseId });
      return cleanAiText(r.generativeAICaseSummary?.summary ?? '');
    });
  }

  /** Analyzes a detection of the case (checks that it belongs to the case: the ID comes from the client). */
  async aiDetection(caseId: string, detectionId: string): Promise<string> {
    if (!(await this.getEvidence(caseId)).detectionIds.includes(detectionId)) throw new SophosError('detection_not_in_case', 404);
    return this.cachedAi(`det:${detectionId}`, async () => {
      const r = await this.graphql<{ generativeAIDetectionAnalysis: { analysis: string } }>(Q_AI_DETECTION, { detectionId });
      return cleanAiText(r.generativeAIDetectionAnalysis?.analysis ?? '');
    });
  }

  // ---------------------------------------------------------------- counts for the portfolio view
  private countsCache: { at: number; data: Counts } | null = null;

  /** Light counts (one aggregation): open and to-handle cases. 2 minute cache. */
  async getCounts(): Promise<Counts> {
    if (this.countsCache && Date.now() - this.countsCache.at < 2 * 60_000) return this.countsCache.data;
    await this.getReference(); // populates this.statuses
    const r = await this.graphql<{ casesAggregation: { aggregation: Record<string, any>[] } }>(Q_AGGREGATION, {
      query: 'where severity >= 0 | aggregate count by primaryStatusId',
    });
    const byId = new Map(this.statuses.map((s) => [s.id, s]));
    const data: Counts = { total: 0, open: 0, actionRequired: 0 };
    for (const row of r.casesAggregation?.aggregation ?? []) {
      const n = Number(row.row_count);
      const s = byId.get(String(row.primaryStatusId));
      data.total += n;
      if (!s?.isClosed) data.open += n;
      if (s?.name === 'customer_action_required') data.actionRequired += n;
    }
    this.countsCache = { at: Date.now(), data };
    return data;
  }

  // ---------------------------------------------------------------- dashboard
  private dashCache = new Map<number, { at: number; data: DashboardData }>();

  async getDashboard(days: number): Promise<DashboardData> {
    const hit = this.dashCache.get(days);
    if (hit && Date.now() - hit.at < DASH_TTL_MS) return hit.data;

    const to = new Date();
    const since = new Date(to.getTime() - days * 86_400_000);
    const sinceIso = since.toISOString().replace(/\.\d+Z$/, 'Z');
    const ref = await this.getReference();

    // in sequence (the Sophos backend does not handle parallel requests well)
    const m = await this.graphql<{ caseSummaryMetrics: any }>(Q_METRICS, {
      input: { from: sinceIso, to: to.toISOString().replace(/\.\d+Z$/, 'Z') },
    });
    const agg = async (by: string) =>
      (
        await this.graphql<{ casesAggregation: { aggregation: Record<string, any>[] } }>(Q_AGGREGATION, {
          query: `where createdAt >= '${sinceIso}' | aggregate count by ${by}`,
        })
      ).casesAggregation?.aggregation ?? [];
    const sevRows = await agg('severity');
    const verdictRows = await agg('primaryVerdictId');

    const cases = await this.getCases({}); // includes the main host (cached)
    const inPeriod = cases.filter((c) => +new Date(c.createdAt) >= since.getTime());

    const sevCount = new Map<CaseSeverity, number>();
    for (const r of sevRows) sevCount.set(toSeverity(r.severity), (sevCount.get(toSeverity(r.severity)) ?? 0) + Number(r.row_count));
    const verdictTitle = new Map(ref.verdicts.map((v) => [v.id, v]));
    const byVerdict = verdictRows.map((r) => {
      const v = verdictTitle.get(String(r.primaryVerdictId));
      return { title: v?.title ?? (currentLang() === 'en' ? 'No verdict' : 'Senza verdetto'), name: v?.name ?? 'none', count: Number(r.row_count) };
    });

    const stCount = new Map<CaseStatus, number>();
    for (const c of inPeriod) stCount.set(c.status, (stCount.get(c.status) ?? 0) + 1);

    // trend: one bin per day (<=31 days) or per week
    const bin = days > 31 ? 7 : 1;
    const nBins = Math.ceil(days / bin);
    const daily = Array.from({ length: nBins }, (_, i) => {
      const start = new Date(to.getTime() - (nBins - i) * bin * 86_400_000);
      return { date: start.toISOString().slice(0, 10), count: 0, start: start.getTime() };
    });
    for (const c of inPeriod) {
      const t = +new Date(c.createdAt);
      const idx = Math.min(nBins - 1, Math.max(0, Math.floor((t - (to.getTime() - nBins * bin * 86_400_000)) / (bin * 86_400_000))));
      daily[idx].count++;
    }

    const data: DashboardData = {
      days,
      generatedAt: new Date().toISOString(),
      kpi: {
        totalCases: m.caseSummaryMetrics.totalCases,
        actionRequiredCases: m.caseSummaryMetrics.actionRequiredCases,
        effortHours: Math.round(m.caseSummaryMetrics.securityOperationsEffortHours * 10) / 10,
        escalatedCases: m.caseSummaryMetrics.escalatedCases,
        weekendCases: m.caseSummaryMetrics.weekendCases,
        openCases: cases.filter((c) => c.status !== 'resolved').length,
      },
      bySeverity: (['critical', 'high', 'medium', 'low'] as CaseSeverity[]).map((key) => ({ key, count: sevCount.get(key) ?? 0 })),
      byVerdict: byVerdict.sort((a, b) => b.count - a.count),
      byStatus: (['actionRequired', 'new', 'investigating', 'onHold', 'resolved'] as CaseStatus[]).map((key) => ({ key, count: stCount.get(key) ?? 0 })),
      daily: daily.map(({ date, count }) => ({ date, count })),
      attention: cases.filter((c) => c.status === 'actionRequired').slice(0, 5),
    };
    this.dashCache.set(days, { at: Date.now(), data });
    return data;
  }

  // ---------------------------------------------------------------- public APIs
  /** Filters and sorting (updatedAt desc) applied here: avoids depending on the CQL syntax. */
  async getCases(filters: CaseFilters): Promise<CaseSummary[]> {
    const all: CaseSummary[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.graphql<{ cases: { cases: any[]; pageInfo?: { hasNextPage: boolean } } }>(
        Q_CASES,
        casesVariables(page),
      );
      all.push(...(data.cases?.cases ?? []).filter((c) => !c.archivedAt).map(normalizeSummary));
      if (!data.cases?.pageInfo?.hasNextPage) break;
    }
    const result = all
      .filter((c) => !filters.statuses?.length || filters.statuses.includes(c.status))
      .filter((c) => !filters.severities?.length || filters.severities.includes(c.severity))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    // Main host on the cards: open cases only (resolved ones do not show it), in sequence, cached.
    // Errors ignored: the list must show up even if the enrichment fails.
    for (const c of result.filter((x) => x.status !== 'resolved').slice(0, MAX_ENRICHED)) {
      try {
        c.primaryEntity = (await this.getEntities(c.id)).find((e) => e.type === 'host')?.name ?? null;
      } catch {
        /* ignore */
      }
    }
    return result;
  }

  async getCaseDetails(caseId: string): Promise<CaseDetails | null> {
    // in sequence, not in parallel (see the note in Q_CASE)
    const c = await this.graphql<{ case: any }>(Q_CASE, caseVariables(caseId));
    if (!c.case) return null;
    const cm = await this.graphql<{ caseComments: { comments: any[] } }>(Q_CASE_COMMENTS, commentsVariables(caseId));
    let ev: Evidence = { entities: [], detectionIds: [], detections: [], mitre: [] };
    try {
      ev = await this.getEvidence(caseId);
    } catch {
      /* evidence unavailable: the detail is shown anyway */
    }
    const rawComments = cm.caseComments?.comments ?? [];
    learnAuthors(rawComments, this.myAuthorIds(), this.colleagues, this.soc);
    const details = normalizeDetails(c.case, rawComments, this.myAuthorIds(), ev.entities, this.colleagues);
    details.detectionIds = ev.detectionIds;
    details.detections = ev.detections;
    details.mitre = ev.mitre;
    return details;
  }

  async addCaseComment(caseId: string, commentText: string): Promise<CaseComment> {
    const data = await this.graphql<{ addCaseComment: any }>(M_ADD_COMMENT, { input: { caseId, comment: commentText } });
    // we wrote the comment ourselves: mark it as "yours" regardless of the authorId
    const mine = new Set(this.myAuthorIds()).add(String(data.addCaseComment?.authorId ?? ''));
    return normalizeComment(data.addCaseComment, mine, this.colleagues);
  }
}


