/**
 * Registry of the reachable tenants (customers).
 *
 * Merges the configured connections (tenant and/or partner credentials). For each customer it checks, with every
 * connection that sees it, WHERE its cases live:
 *   - Fusion (GraphQL `cases`)            -> full features (comments, classification, AI, metrics);
 *   - Sophos Central classic (REST /cases/v1) -> read-only.
 * Selection rule: Fusion if it has cases; otherwise classic if it has cases; otherwise Fusion (if it answers), then classic.
 * Inaccessible customers (not migrated, no partner delegation...) stay in the list as "unavailable" and
 * are retried every 30 minutes: as soon as they become accessible they show up on their own.
 */
import { config } from '../config';
import type { Capabilities, TenantKind } from '../types';
import type { CaseBackend } from './backend';
import { ClassicApi } from './classicApi';
import { Connection, SophosError } from './sophosConnection';
import { Counts, TenantApi } from './sophosClient';

export type Reason = 'access_denied' | 'no_service' | 'error';

export interface TenantInfo {
  id: string;
  name: string;
  region?: string;
  status: 'ok' | 'unavailable' | 'unknown';
  kind?: TenantKind;
  capabilities?: Capabilities;
  reason?: Reason;
  caseCount?: number;
}

interface Candidate {
  id: string;
  name?: string;
  region?: string;
  apiHost?: string;
}

interface Entry extends TenantInfo {
  api?: CaseBackend;
  probedAt: number;
  /** connections that see this customer, with the regional host for classic REST */
  sources: { conn: Connection; apiHost?: string }[];
}

const REFRESH_MS = 30 * 60_000;
const ON_DEMAND_MS = 5 * 60_000; // do not re-probe an unavailable customer more often than this
const FUSION_PROBE = '{ cases(arguments: { pagination: { offset: { page: 1, perPage: 1 } } }) { totalCount } }';

function classify(e: unknown): Reason {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof SophosError && e.status === 403) return 'access_denied';
  if (/GetTenant|not found|tenantsv4/i.test(m)) return 'no_service';
  return 'error';
}

export class Registry {
  private conns = config.sophos.connections.map((c, i) => new Connection(i + 1, c.clientId, c.clientSecret));
  private tenants = new Map<string, Entry>();
  private refreshing: Promise<void> | null = null;
  private resolveReady!: () => void;
  /** Resolves when the first connection has listed its tenants (enough to answer the first requests). */
  readonly ready = new Promise<void>((res) => (this.resolveReady = res));
  lastRefresh = 0;

  start() {
    void this.refresh();
    setInterval(() => void this.refresh(), REFRESH_MS).unref();
  }

  get probing() {
    return this.refreshing !== null;
  }

  /** List for the UI: accessible customers first (most cases on top), then the others. */
  list(): TenantInfo[] {
    const rank = { ok: 0, unknown: 1, unavailable: 2 } as const;
    return [...this.tenants.values()]
      .map(({ api: _a, probedAt: _p, sources: _s, ...t }) => t)
      .sort((a, b) => rank[a.status] - rank[b.status] || (b.caseCount ?? 0) - (a.caseCount ?? 0) || a.name.localeCompare(b.name));
  }

  private async waitReady() {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 20_000))]);
  }

  /** Backend of the customer if accessible; probes on the spot if not yet checked. */
  async get(id: string): Promise<CaseBackend | null> {
    await this.waitReady();
    const e = this.tenants.get(id);
    if (!e) return null;
    if (e.status !== 'ok' && Date.now() - e.probedAt > ON_DEMAND_MS) await this.probe(e);
    return e.status === 'ok' ? (e.api ?? null) : null;
  }

  /** Default customer (requests without an explicit customer): the first accessible one with cases, or the first accessible one. */
  async first(): Promise<CaseBackend | null> {
    await this.waitReady();
    const ok = this.list().filter((t) => t.status === 'ok');
    return ok.length ? ((await this.get(ok[0].id)) ?? null) : null;
  }

  /** Counts for the portfolio view, in sequence (the Sophos backend does not handle parallel requests well). */
  async portfolio(): Promise<(TenantInfo & { counts?: Counts })[]> {
    const out: (TenantInfo & { counts?: Counts })[] = [];
    for (const t of this.list()) {
      const api = t.status === 'ok' ? this.tenants.get(t.id)?.api : undefined;
      if (!api) {
        out.push(t);
        continue;
      }
      try {
        out.push({ ...t, counts: await api.getCounts() });
      } catch {
        out.push(t);
      }
    }
    return out;
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
      this.lastRefresh = Date.now();
    });
    return this.refreshing;
  }

  // ---------------------------------------------------------------- internal
  private async candidates(conn: Connection): Promise<Candidate[]> {
    const who = await conn.whoami();
    if (who.idType === 'tenant') {
      return [{ id: who.id, name: await this.tenantName(conn, who.id), apiHost: who.apiHosts.dataRegion }];
    }
    return conn.listTenants();
  }

  /** Customer name from Taegis (best effort: tenant credentials do not expose it elsewhere). */
  private async tenantName(conn: Connection, id: string): Promise<string | undefined> {
    try {
      const r = await conn.graphql<{ tenants: { tenants: { name: string }[] } }>(
        id,
        'query($q: TenantsQuery!) { tenants(tenantsQuery: $q) { tenants { name } } }',
        { q: { ids: [id] } },
      );
      return r.tenants?.tenants?.[0]?.name;
    } catch {
      return undefined;
    }
  }

  private async doRefresh(): Promise<void> {
    // 1) list of all customers from all connections
    for (const conn of this.conns) {
      try {
        for (const c of await this.candidates(conn)) {
          const e =
            this.tenants.get(c.id) ??
            ({ id: c.id, name: `Cliente ${c.id.slice(0, 8)}`, status: 'unknown', probedAt: 0, sources: [] } as Entry);
          // the partner's name takes precedence over a name obtained elsewhere
          if (c.name && (conn.index === 1 || e.name.startsWith('Cliente '))) e.name = c.name;
          else if (c.name && !e.name) e.name = c.name;
          e.region = c.region ?? e.region;
          if (!e.sources.some((s) => s.conn === conn)) e.sources.push({ conn, apiHost: c.apiHost });
          this.tenants.set(c.id, e);
        }
      } catch (err) {
        console.error(`[registry] connessione ${conn.index}:`, err instanceof Error ? err.message : err);
      }
      if (conn.index === 1) this.resolveReady();
    }
    this.resolveReady();

    // 2) check where each customer's cases live (sequential, with a short pause)
    for (const e of [...this.tenants.values()]) {
      await this.probe(e);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** Checks Fusion and classic with every connection that sees the customer and picks the best backend. */
  private async probe(e: Entry): Promise<void> {
    type Found = { kind: TenantKind; count: number; make: () => CaseBackend };
    const found: Found[] = [];
    let reason: Reason = 'error';

    for (const { conn, apiHost } of e.sources) {
      try {
        const r = await conn.graphql<{ cases: { totalCount: number } }>(e.id, FUSION_PROBE);
        found.push({ kind: 'fusion', count: r.cases?.totalCount ?? 0, make: () => new TenantApi(conn, e.id) });
      } catch (err) {
        reason = classify(err);
      }
      if (apiHost) {
        try {
          const r = await conn.rest<{ pages?: { items?: number }; items?: unknown[] }>(apiHost, e.id, '/cases/v1/cases?pageSize=1&pageTotal=true');
          found.push({ kind: 'classic', count: r.pages?.items ?? r.items?.length ?? 0, make: () => new ClassicApi(conn, e.id, apiHost) });
        } catch (err) {
          if (!found.length) reason = classify(err);
        }
      }
    }

    // choice: Fusion with cases > classic with cases > Fusion > classic
    const best =
      found.find((f) => f.kind === 'fusion' && f.count > 0) ??
      found.find((f) => f.kind === 'classic' && f.count > 0) ??
      found.find((f) => f.kind === 'fusion') ??
      found.find((f) => f.kind === 'classic');

    if (!best) {
      // transient errors on a customer that was working: keep the previous state
      if (e.status === 'ok' && reason === 'error') {
        e.probedAt = Date.now();
        return;
      }
      Object.assign(e, { status: 'unavailable', reason, api: undefined, kind: undefined, capabilities: undefined, caseCount: undefined, probedAt: Date.now() });
      return;
    }
    const api = best.make();
    Object.assign(e, { status: 'ok', reason: undefined, api, kind: best.kind, capabilities: api.capabilities, caseCount: best.count, probedAt: Date.now() });
  }
}

export const registry = new Registry();
