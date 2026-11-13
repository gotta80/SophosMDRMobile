/**
 * Client Sophos.
 *  1. POST id.sophos.com/api/v2/oauth2/token  (client_credentials, scope=token) -> JWT, cache in memoria
 *  2. GET  api.central.sophos.com/whoami/v1    -> id e idType (tenant | organization | partner | distributor)
 *  3. POST api.taegis.sophos.com/graphql       -> Cases GraphQL (Authorization + X-Tenant-ID)
 * Segreti e token restano solo nel backend.
 */
import { config } from '../config';
import type { CaseComment, CaseDetails, CaseFilters, CaseSummary, Entity } from '../types';
import {
  M_ADD_COMMENT,
  Q_CASES,
  Q_ASSET,
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

interface Whoami {
  id: string;
  idType: 'tenant' | 'organization' | 'partner' | 'distributor';
  apiHosts: { global: string; dataRegion?: string };
}

const SKEW_MS = 60_000; // rinnova 60s prima della scadenza
const MAX_PAGES = 3; // fino a 300 casi
const ENTITY_TTL_MS = 10 * 60_000;
const MAX_ASSETS = 10; // asset risolti per caso
const MAX_ENRICHED = 25; // casi aperti arricchiti con l'host nella lista

export class SophosError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

class SophosClient {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private tenantId: string | null = null;
  private tenantPromise: Promise<string> | null = null;

  /** ID autore dei commenti scritti da questa app (per distinguerli da quelli degli analisti). */
  private myAuthorIds(): Set<string> {
    return new Set([config.sophos.clientId, ...config.sophos.myAuthorIds].filter(Boolean));
  }

  // ---------------------------------------------------------------- auth
  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - SKEW_MS > Date.now()) return this.token.value;
    this.tokenPromise ??= this.fetchToken().finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.sophos.clientId,
      client_secret: config.sophos.clientSecret,
      scope: 'token',
    });
    const res = await fetch(config.sophos.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new SophosError(`Autenticazione Sophos fallita (${res.status})`, 502);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  // ---------------------------------------------------------------- tenant (whoami)
  private async getTenantId(): Promise<string> {
    if (this.tenantId) return this.tenantId;
    this.tenantPromise ??= this.resolveTenant().finally(() => (this.tenantPromise = null));
    return (this.tenantId = await this.tenantPromise);
  }

  private async resolveTenant(): Promise<string> {
    if (config.sophos.tenantId) return config.sophos.tenantId; // Partner/Organization: tenant esplicito
    const token = await this.getToken();
    const res = await fetch(config.sophos.whoamiUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new SophosError(`whoami Sophos fallito (${res.status})`);
    const who = (await res.json()) as Whoami;
    if (who.idType !== 'tenant') {
      throw new SophosError(`Credenziali ${who.idType}: imposta SOPHOS_TENANT_ID nel .env`, 500);
    }
    return who.id;
  }

  // ---------------------------------------------------------------- GraphQL
  private async graphql<T>(query: string, variables: Record<string, unknown>, retry = true, attempt = 1): Promise<T> {
    const tenant = await this.getTenantId();
    const token = await this.getToken();
    const res = await fetch(config.sophos.graphqlUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenant, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && retry) {
      this.token = null; // token scaduto/revocato: rinnova e riprova una volta
      await this.getToken(true);
      return this.graphql<T>(query, variables, false);
    }
    if (!res.ok) throw new SophosError(`GraphQL Sophos HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    // Errori GraphQL = HTTP 200 con array `errors`
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join('; ');
      // errori transitori del backend Sophos (database occupato): riprova con breve attesa
      if (attempt < 3 && /conn busy|bad connection|timeout|temporar/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        return this.graphql<T>(query, variables, retry, attempt + 1);
      }
      // permessi insufficienti sul ruolo della credenziale API (es. ReadOnly che prova a scrivere)
      if (/not authorized/i.test(msg)) throw new SophosError(`not_authorized: ${msg}`, 403);
      throw new SophosError(`GraphQL: ${msg}`);
    }
    return json.data as T;
  }

  // ---------------------------------------------------------------- entità (host / utenti)
  private entityCache = new Map<string, { at: number; entities: Entity[] }>();

  /** Host e utenti del caso (cache 10 min). Chiamate in sequenza: il backend Sophos soffre le richieste parallele. */
  private async getEntities(caseId: string): Promise<Entity[]> {
    const hit = this.entityCache.get(caseId);
    if (hit && Date.now() - hit.at < ENTITY_TTL_MS) return hit.entities;
    const ev = await this.graphql<{ caseEvidence: { assetsEvidence?: { assetId: string }[] } }>(
      Q_CASE_EVIDENCE,
      evidenceVariables(caseId),
    );
    const entities: Entity[] = [];
    for (const { assetId } of (ev.caseEvidence?.assetsEvidence ?? []).slice(0, MAX_ASSETS)) {
      const r = await this.graphql<{ assetsV2: { assets: any[] } }>(Q_ASSET, assetVariables(assetId));
      for (const a of r.assetsV2?.assets ?? []) entities.push(...assetToEntities(a));
    }
    this.entityCache.set(caseId, { at: Date.now(), entities });
    return entities;
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
    let entities: Entity[] = [];
    try {
      entities = await this.getEntities(caseId);
    } catch {
      /* host/utenti non disponibili: il dettaglio si mostra comunque */
    }
    return normalizeDetails(c.case, cm.caseComments?.comments ?? [], this.myAuthorIds(), entities);
  }

  async addCaseComment(caseId: string, commentText: string): Promise<CaseComment> {
    const data = await this.graphql<{ addCaseComment: any }>(M_ADD_COMMENT, { input: { caseId, comment: commentText } });
    // il commento l'abbiamo scritto noi: lo marchiamo come "tuo" a prescindere dall'authorId
    const mine = new Set(this.myAuthorIds()).add(String(data.addCaseComment?.authorId ?? ''));
    return normalizeComment(data.addCaseComment, mine);
  }
}

export const sophosClient = new SophosClient();
