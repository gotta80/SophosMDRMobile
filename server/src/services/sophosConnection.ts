/**
 * Connessione Sophos = una coppia client id/secret (credenziale API).
 *  - token OAuth2 in cache (rinnovato prima della scadenza);
 *  - whoami -> tipo di credenziale (tenant | partner | organization | distributor);
 *  - graphql(tenantId, ...) verso api.taegis.sophos.com con X-Tenant-ID del cliente scelto.
 * Una connessione partner/organization può elencare i tenant dei clienti.
 */
import { config } from '../config';

export class SophosError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export interface Whoami {
  id: string;
  idType: 'tenant' | 'organization' | 'partner' | 'distributor';
  apiHosts: { global: string; dataRegion?: string };
}

export interface RawTenant {
  id: string;
  name: string;
  dataRegion?: string;
  apiHost?: string;
}

const SKEW_MS = 60_000; // rinnova 60s prima della scadenza

export class Connection {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private who: Whoami | null = null;

  constructor(
    public readonly index: number,
    public readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  // ---------------------------------------------------------------- auth
  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - SKEW_MS > Date.now()) return this.token.value;
    this.tokenPromise ??= this.fetchToken().finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(config.sophos.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'token',
      }),
    });
    if (!res.ok) throw new SophosError(`Autenticazione Sophos fallita (connessione ${this.index}, HTTP ${res.status})`, 502);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  async whoami(): Promise<Whoami> {
    if (this.who) return this.who;
    const token = await this.getToken();
    const res = await fetch(config.sophos.whoamiUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new SophosError(`whoami Sophos fallito (HTTP ${res.status})`);
    return (this.who = (await res.json()) as Whoami);
  }

  /** Tenant dei clienti (solo credenziali partner/organization). */
  async listTenants(): Promise<RawTenant[]> {
    const who = await this.whoami();
    if (who.idType !== 'partner' && who.idType !== 'organization') return [];
    const token = await this.getToken();
    const idHeader = who.idType === 'partner' ? 'X-Partner-ID' : 'X-Organization-ID';
    const out: RawTenant[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${who.apiHosts.global}/${who.idType}/v1/tenants?pageTotal=true&pageSize=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, [idHeader]: who.id },
      });
      if (!res.ok) throw new SophosError(`Elenco tenant fallito (HTTP ${res.status})`);
      const j = (await res.json()) as { items?: { id: string; name?: string; showAs?: string; dataRegion?: string; apiHost?: string }[]; pages?: { total?: number } };
      for (const t of j.items ?? []) out.push({ id: t.id, name: t.name || t.showAs || t.id, dataRegion: t.dataRegion, apiHost: t.apiHost });
      if (page >= (j.pages?.total ?? 1)) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- REST (Sophos Central classic)
  /** GET su un'API regionale di Central (es. /cases/v1/cases) per un cliente: `apiHost` = host regionale del tenant. */
  async rest<T>(apiHost: string, tenantId: string, path: string, retry = true): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${apiHost}${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantId } });
    if (res.status === 401 && retry) {
      this.token = null;
      await this.getToken(true);
      return this.rest<T>(apiHost, tenantId, path, false);
    }
    if (res.status === 403) throw new SophosError('not_authorized: accesso negato alle API Central del cliente', 403);
    if (res.status === 404) throw new SophosError('not_found', 404);
    if (!res.ok) throw new SophosError(`Central HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Host regionale (dataRegion) della credenziale di tenant, da whoami. */
  async ownApiHost(): Promise<string | undefined> {
    return (await this.whoami()).apiHosts.dataRegion;
  }

  // ---------------------------------------------------------------- GraphQL
  async graphql<T>(tenantId: string, query: string, variables: Record<string, unknown> = {}, retry = true, attempt = 1): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(config.sophos.graphqlUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && retry) {
      this.token = null; // token scaduto/revocato: rinnova e riprova una volta
      await this.getToken(true);
      return this.graphql<T>(tenantId, query, variables, false, attempt);
    }
    if (!res.ok) throw new SophosError(`GraphQL Sophos HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    // Errori GraphQL = HTTP 200 con array `errors`
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join('; ');
      // errori transitori del backend Sophos (database occupato): riprova con breve attesa
      if (attempt < 3 && /conn busy|bad connection|timeout|temporar/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        return this.graphql<T>(tenantId, query, variables, retry, attempt + 1);
      }
      // permessi insufficienti sul ruolo della credenziale, o tenant non accessibile con questa credenziale
      if (/not authorized|authorization denied/i.test(msg)) throw new SophosError(`not_authorized: ${msg}`, 403);
      throw new SophosError(`GraphQL: ${msg}`);
    }
    return json.data as T;
  }
}
