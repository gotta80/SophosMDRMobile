/**
 * Customer licenses and MDR level.
 *
 * Source: Sophos Central Licensing API (`GET {global}/licenses/v1/licenses` with X-Tenant-ID), which works for both
 * Fusion and classic customers. For Fusion customers, if the REST call fails, the GraphQL `tenantLicenses` query is
 * used as a fallback (no dates or quantities there). The MDR level comes from the product codes:
 *   ...MTR-ADV... -> MDR Plus (formerly MDR Complete / MTR Advanced)
 *   ...MDR-COMPLETE... (MDR-COMPLETE, SRVMDR-COMPLETE) -> MDR Plus
 *   ...MDR / SRVMDR / USRMDR... -> MDR
 *   ...MTR-STD... -> MDR (formerly MDR Essential / MTR Standard)
 * Expired licenses and pay-as-you-go licenses with no seat in use never count for the level.
 */
import type { LicenseItem, MdrLevel, TenantLicenses } from '../types';
import type { Connection } from './sophosConnection';

const TTL_MS = 60 * 60_000; // 1 h
const DAY_MS = 86_400_000;
const MDR_RE = /MDR|MTR/i;

/** True if the term license is past its end date (the end date is inclusive). */
export function isExpired(l: { perpetual?: boolean; endDate?: string }, now = Date.now()): boolean {
  if (l.perpetual || !l.endDate) return false;
  const end = Date.parse(l.endDate);
  return Number.isFinite(end) && end + DAY_MS <= now;
}

export const isMdrProduct = (code: string, name: string) => MDR_RE.test(code) || MDR_RE.test(name);

type Licensish = { code: string; name?: string; endDate?: string; perpetual?: boolean; type?: string; usage?: number };

/**
 * A license counts as active when it is not expired and, for pay-as-you-go (usage) licenses, has at least one seat in use.
 * (`usage` undefined = unknown, e.g. the GraphQL fallback has no usage data: counted as active.)
 */
export function isActive(l: Licensish, now = Date.now()): boolean {
  return !isExpired(l, now) && !(l.type === 'usage' && l.usage === 0);
}

/** MDR level from the licenses that are in use (pure function). */
export function mdrLevel(items: Licensish[], now = Date.now()): MdrLevel {
  const live = items.filter((l) => isActive(l, now));
  const codes = live.map((l) => l.code.toUpperCase());
  if (codes.some((c) => c.includes('MTR-ADV') || c.includes('MDR-COMPLETE'))) return 'mdr_plus';
  if (codes.some((c) => c.includes('MTR-STD') || /(^|[^A-Z])(SRV|USR)?MDR($|[^A-Z])/.test(c))) return 'mdr';
  if (live.some((l) => isMdrProduct(l.code, l.name ?? ''))) return 'mdr';
  return 'none';
}

const day = (s?: unknown) => (typeof s === 'string' && s ? s.slice(0, 10) : undefined);
const kind = (t: unknown): LicenseItem['type'] => (t === 'term' ? 'term' : t === 'usage' ? 'usage' : 'other');

/** Normalizes the REST Licensing API response. */
export function parseRestLicenses(json: unknown): LicenseItem[] {
  const rows = ((json as { licenses?: any[] })?.licenses ?? []) as any[];
  return rows.map((r, i) => {
    const code = String(r.product?.code ?? '');
    const name = String(r.product?.name ?? code);
    const perpetual = !!r.perpetual;
    const endDate = day(r.endDate);
    return {
      id: String(r.id ?? r.licenseIdentifier ?? i),
      code,
      name,
      type: kind(r.type),
      mdr: isMdrProduct(code, name),
      expired: isExpired({ perpetual, endDate }),
      quantity: typeof r.quantity === 'number' ? r.quantity : undefined,
      unlimited: r.unlimited ? true : undefined,
      perpetual: perpetual || undefined,
      startDate: day(r.startDate),
      endDate,
      // pay-as-you-go licenses without usage data have no seat in use
      usage: typeof r.usage?.current?.count === 'number' ? r.usage.current.count : kind(r.type) === 'usage' ? 0 : undefined,
    };
  });
}

const Q_LICENSES =
  'query { tenantLicenses(tenantLicenses: { pageSize: 100 }) { licenses { licenseIdentifier type product { code name features } } } }';

/** Normalizes the Fusion GraphQL response (no dates or quantities). */
export function parseGraphqlLicenses(data: unknown): LicenseItem[] {
  const rows = ((data as { tenantLicenses?: { licenses?: any[] } })?.tenantLicenses?.licenses ?? []) as any[];
  return rows.map((r, i) => {
    const code = String(r.product?.code ?? '');
    const name = String(r.product?.name ?? code);
    return {
      id: `${r.licenseIdentifier ?? 'lic'}-${code}-${i}`,
      code,
      name,
      type: kind(r.type),
      mdr: isMdrProduct(code, name),
      expired: false,
      features: Array.isArray(r.product?.features) && r.product.features.length ? r.product.features.map(String) : undefined,
    };
  });
}

export function build(licenses: LicenseItem[], source: TenantLicenses['source']): TenantLicenses {
  return { mdr: mdrLevel(licenses), licenses, source, fetchedAt: new Date().toISOString() };
}

/** Reads a customer's licenses: REST first, GraphQL fallback for Fusion customers. */
export async function fetchLicenses(conn: Connection, tenantId: string, fusion: boolean): Promise<TenantLicenses> {
  try {
    return build(parseRestLicenses(await conn.globalRest<unknown>(tenantId, '/licenses/v1/licenses')), 'rest');
  } catch (err) {
    if (!fusion) throw err;
    const data = await conn.graphql<unknown>(tenantId, Q_LICENSES);
    return build(parseGraphqlLicenses(data), 'graphql');
  }
}

/** 1 h in-memory cache with deduplication of concurrent reads. */
export class LicenseStore {
  private hit: { at: number; v: TenantLicenses } | null = null;
  private pending: Promise<TenantLicenses> | null = null;

  constructor(private readonly load: () => Promise<TenantLicenses>) {}

  async get(force = false): Promise<TenantLicenses> {
    if (!force && this.hit && Date.now() - this.hit.at < TTL_MS) return this.hit.v;
    this.pending ??= this.load()
      .then((v) => {
        this.hit = { at: Date.now(), v };
        return v;
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }
}
