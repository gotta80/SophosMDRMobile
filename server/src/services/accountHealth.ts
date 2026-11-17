/**
 * Sophos Central "Account Health Check" scores of a customer (REST: GET {apiHost}/account-health-check/v1/health-check).
 * The API returns one score (0..100) per check, grouped by area; there is no overall score: like the console, the
 * overall value is the lowest score among the checks. Checks without devices (total 0) and snoozed ones are not
 * counted. Customers with the MDR service also get the MDR checks (data telemetry, authorized contact).
 */
import type { AccountHealth, HealthItem } from '../types';
import type { Connection } from './sophosConnection';

type Raw = Record<string, any>;

const TTL_MS = 10 * 60_000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

/** Pure parser of the API answer. Unknown or missing sections are skipped. */
export function parseHealth(raw: Raw, now = new Date()): AccountHealth {
  const items: HealthItem[] = [];
  const add = (id: string, group: HealthItem['group'], c: Raw | undefined, detail: string[] = []) => {
    const score = num(c?.score);
    if (score === null) return;
    // device-based checks with no device are not applicable (the API reports 100)
    const empty = typeof c?.total === 'number' && c.total === 0;
    if (empty && (id.startsWith('protection.') || id === 'tamper.computer' || id === 'tamper.server')) return;
    items.push({ id, group, score, total: typeof c?.total === 'number' ? c.total : undefined, snoozed: !!c?.snoozed, detail });
  };

  const ep = (raw.endpoint ?? raw) as Raw;
  add('protection.computer', 'endpoint', ep.protection?.computer);
  add('protection.server', 'endpoint', ep.protection?.server);
  for (const kind of ['computer', 'server'] as const) {
    for (const c of Object.values((ep.policy?.[kind] ?? {}) as Raw)) {
      const policies = ((c as Raw).policies ?? []) as Raw[];
      add(`policy.${kind}`, 'endpoint', c as Raw, policies.map((p) => String(p.name)).filter(Boolean));
    }
  }
  add('exclusions.computer', 'endpoint', ep.exclusions?.policy?.computer);
  add('exclusions.server', 'endpoint', ep.exclusions?.policy?.server);
  add('exclusions.global', 'endpoint', ep.exclusions?.global);
  add('tamper.computer', 'endpoint', ep.tamperProtection?.computer);
  add('tamper.server', 'endpoint', ep.tamperProtection?.server);
  add('tamper.global', 'endpoint', ep.tamperProtection?.globalDetail);

  const mdr = (raw.mdrDataTelemetry ?? ep.mdrDataTelemetry) as Raw | undefined;
  add('mdr.telemetry', 'mdr', mdr?.protectionImprovement, ((mdr?.protectionImprovement?.missingSettings ?? []) as unknown[]).map(String));
  const ac = (raw.mdrAuthorizedContact ?? ep.mdrAuthorizedContact) as Raw | undefined;
  add('mdr.contact', 'mdr', ac?.contact);

  const counted = items.filter((i) => !i.snoozed);
  return {
    score: counted.length ? Math.min(...counted.map((i) => i.score)) : null,
    items,
    fetchedAt: now.toISOString(),
  };
}

export async function fetchAccountHealth(conn: Connection, apiHost: string, tenantId: string): Promise<AccountHealth> {
  return parseHealth(await conn.rest<Raw>(apiHost, tenantId, '/account-health-check/v1/health-check'));
}

/** 10 min in-memory cache with deduplication of concurrent reads. */
export class HealthStore {
  private hit: { at: number; v: AccountHealth } | null = null;
  private pending: Promise<AccountHealth> | null = null;

  constructor(private readonly load: () => Promise<AccountHealth>) {}

  get(force = false): Promise<AccountHealth> {
    if (!force && this.hit && Date.now() - this.hit.at < TTL_MS) return Promise.resolve(this.hit.v);
    this.pending ??= this.load()
      .then((v) => {
        this.hit = { at: Date.now(), v };
        return v;
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }
}
