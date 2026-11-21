import 'dotenv/config';
import path from 'path';

const bool = (v: string | undefined, def = false): boolean =>
  v === undefined || v.trim() === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 3456),
  /** In Docker use 0.0.0.0 (the port is anyway published only on 127.0.0.1 by the compose file). */
  host: process.env.HOST || '127.0.0.1',
  mock: bool(process.env.MOCK_MODE, false),

  /** Behind a reverse proxy: legge X-Forwarded-* (req.secure, req.ip). */
  trustProxy: bool(process.env.TRUST_PROXY, false),

  /** Access PINs: APP_ACCESS_PIN accepts several, separated by commas. */
  accessPins: (process.env.APP_ACCESS_PIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  sessionSecret: process.env.SESSION_SECRET || '',
  /** Audit log file (JSON lines). Production default: /data/audit.jsonl (Docker volume); empty = memory + container log only. */
  auditFile: process.env.AUDIT_LOG_FILE ?? (isProd ? '/data/audit.jsonl' : ''),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  /**
   * Cookie "Secure": 'auto' (default) = only if the request is HTTPS (req.secure, which with TRUST_PROXY
   * reads X-Forwarded-Proto from the proxy). This way it works both from the LAN over HTTP and through the HTTPS proxy.
   * COOKIE_SECURE=true/false forces the value.
   */
  cookieSecure: ((v) => (v === undefined || v.trim() === '' || v.trim() === 'auto' ? 'auto' : bool(v)))(
    process.env.COOKIE_SECURE,
  ) as boolean | 'auto',

  staticDir: process.env.STATIC_DIR || path.resolve(__dirname, '../../web/dist'),

  sophos: {
    /**
     * Connections (API credentials): SOPHOS_CLIENT_ID/SECRET, then SOPHOS_CLIENT_ID_2/SECRET_2, ... up to _6.
     * Each can be a tenant (one customer) or a partner/organization (lists the customers): the tenant registry
     * merges them and, for each customer, uses the first connection that can read its cases.
     */
    connections: [1, 2, 3, 4, 5, 6]
      .map((i) => {
        const s = i === 1 ? '' : `_${i}`;
        return { clientId: process.env[`SOPHOS_CLIENT_ID${s}`] || '', clientSecret: process.env[`SOPHOS_CLIENT_SECRET${s}`] || '' };
      })
      .filter((c) => c.clientId && c.clientSecret),
    tokenUrl: process.env.SOPHOS_TOKEN_URL || 'https://id.sophos.com/api/v2/oauth2/token',
    whoamiUrl: process.env.SOPHOS_WHOAMI_URL || 'https://api.central.sophos.com/whoami/v1',
    /** Cases GraphQL endpoint (the same for all tenants, from developer.sophos.com). */
    graphqlUrl: process.env.SOPHOS_GRAPHQL_URL || 'https://api.taegis.sophos.com/graphql',
    /** Author IDs (authorId) to treat as "yours" in the chat, comma-separated. See README. */
    myAuthorIds: (process.env.SOPHOS_MY_AUTHOR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (config.accessPins.length === 0) errors.push('APP_ACCESS_PIN is missing: set it in the .env file');
  if (!config.mock && config.sophos.connections.length === 0) {
    errors.push('SOPHOS_CLIENT_ID / SOPHOS_CLIENT_SECRET are missing (or use MOCK_MODE=true)');
  }
  return errors;
}
