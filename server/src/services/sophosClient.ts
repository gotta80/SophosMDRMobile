import { currentLang } from '../lang';
/**
 * Client Sophos.
 *  1. POST id.sophos.com/api/v2/oauth2/token  (client_credentials, scope=token) -> JWT, cache in memoria
 *  2. GET  api.central.sophos.com/whoami/v1    -> id e idType (tenant | organization | partner | distributor)
 *  3. POST api.taegis.sophos.com/graphql       -> Cases GraphQL (Authorization + X-Tenant-ID)
 * Segreti e token restano solo nel backend.
 */
import { config } from '../config';
import { Connection, SophosError } from './sophosConnection';
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
  normalizeComment,
  normalizeDetails,
  normalizeSummary,
} from './sophosQueries';

const MAX_PAGES = 3; // fino a 300 casi
const ENTITY_TTL_MS = 10 * 60_000;
const MAX_DETECTIONS = 20; // detection recuperate per caso
const REF_TTL_MS = 60 * 60_000; // dati di riferimento e risposte AI
const DASH_TTL_MS = 60_000;
const MAX_ASSETS = 10; // asset risolti per caso
const MAX_ENRICHED = 25; // casi aperti arricchiti con l'host nella lista

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

/** API di un singolo cliente (tenant), raggiunto tramite una connessione. Le cache sono per tenant. */
export class TenantApi implements CaseBackend {
  readonly kind = 'fusion' as const;
  readonly capabilities = { comments: true, classify: true, ai: true };

  constructor(
    private readonly conn: Connection,
    readonly tenantId: string,
  ) {}

  /** ID autore dei commenti scritti da questa app (per distinguerli da quelli degli analisti). */
  private myAuthorIds(): Set<string> {
    return new Set([this.conn.clientId, ...config.sophos.myAuthorIds].filter(Boolean));
  }

  private graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.conn.graphql<T>(this.tenantId, query, variables);
  }
  // ---------------------------------------------------------------- entità (host / utenti)
  private evidenceCache = new Map<string, { at: number } & Evidence>();
  /** Se la credenziale non ha Agent:read gli asset non sono risolvibili: non riprovare per un'ora. */
  private assetsDeniedUntil = 0;

  /**
   * Evidenze del caso (cache 10 min): detection (titolo, severità, MITRE), host e utenti.
   * Fonte principale: alert delle detection (Alert:read). Gli asset (Agent:read) arricchiscono con lo stato
   * di isolamento, se il ruolo lo consente. Ogni passo è best-effort. Chiamate in sequenza.
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
        /* detection non disponibili: si mostrano solo gli ID */
      }
    }

    // Stato di isolamento (e host per i casi senza detection) dagli asset, solo se il ruolo ha Agent:read
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

  // ---------------------------------------------------------------- dati di riferimento (cache 1 h)
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

  // ---------------------------------------------------------------- classificazione / chiusura del caso
  /**
   * Imposta il verdetto (es. False Positive) e, se `close`, chiude il caso. Una sola updateCase (semantica PATCH).
   * Compatibilità verdetto/motivazione e requisiti di chiusura sono validati da Sophos: l'errore viene riportato all'utente.
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

  // ---------------------------------------------------------------- spiegazioni AI (cache 1 h: ~15 s l'una)
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
      return r.generativeAICaseSummary?.summary ?? '';
    });
  }

  /** Analizza una detection del caso (verifica che appartenga al caso: l'ID arriva dal client). */
  async aiDetection(caseId: string, detectionId: string): Promise<string> {
    if (!(await this.getEvidence(caseId)).detectionIds.includes(detectionId)) throw new SophosError('detection_not_in_case', 404);
    return this.cachedAi(`det:${detectionId}`, async () => {
      const r = await this.graphql<{ generativeAIDetectionAnalysis: { analysis: string } }>(Q_AI_DETECTION, { detectionId });
      return r.generativeAIDetectionAnalysis?.analysis ?? '';
    });
  }

  // ---------------------------------------------------------------- conteggi per la vista portafoglio
  private countsCache: { at: number; data: Counts } | null = null;

  /** Conteggi leggeri (una aggregazione): casi aperti e da gestire. Cache 2 minuti. */
  async getCounts(): Promise<Counts> {
    if (this.countsCache && Date.now() - this.countsCache.at < 2 * 60_000) return this.countsCache.data;
    await this.getReference(); // popola this.statuses
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

    // in sequenza (il backend Sophos non regge bene le richieste parallele)
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

    const cases = await this.getCases({}); // include host principale (cache)
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

    // andamento: un bin per giorno (<=31 gg) oppure per settimana
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

  // ---------------------------------------------------------------- API pubbliche
  /** Filtri e ordinamento (updatedAt desc) applicati qui: evita di dipendere dalla sintassi CQL. */
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

    // Host principale sulle card: solo casi aperti (i risolti non lo mostrano), in sequenza, con cache.
    // Errori ignorati: la lista deve comparire anche se l'arricchimento fallisce.
    for (const c of result.filter((x) => x.status !== 'resolved').slice(0, MAX_ENRICHED)) {
      try {
        c.primaryEntity = (await this.getEntities(c.id)).find((e) => e.type === 'host')?.name ?? null;
      } catch {
        /* ignora */
      }
    }
    return result;
  }

  async getCaseDetails(caseId: string): Promise<CaseDetails | null> {
    // in sequenza, non in parallelo (vedi nota in Q_CASE)
    const c = await this.graphql<{ case: any }>(Q_CASE, caseVariables(caseId));
    if (!c.case) return null;
    const cm = await this.graphql<{ caseComments: { comments: any[] } }>(Q_CASE_COMMENTS, commentsVariables(caseId));
    let ev: Evidence = { entities: [], detectionIds: [], detections: [], mitre: [] };
    try {
      ev = await this.getEvidence(caseId);
    } catch {
      /* evidenze non disponibili: il dettaglio si mostra comunque */
    }
    const details = normalizeDetails(c.case, cm.caseComments?.comments ?? [], this.myAuthorIds(), ev.entities);
    details.detectionIds = ev.detectionIds;
    details.detections = ev.detections;
    details.mitre = ev.mitre;
    return details;
  }

  async addCaseComment(caseId: string, commentText: string): Promise<CaseComment> {
    const data = await this.graphql<{ addCaseComment: any }>(M_ADD_COMMENT, { input: { caseId, comment: commentText } });
    // il commento l'abbiamo scritto noi: lo marchiamo come "tuo" a prescindere dall'authorId
    const mine = new Set(this.myAuthorIds()).add(String(data.addCaseComment?.authorId ?? ''));
    return normalizeComment(data.addCaseComment, mine);
  }
}


