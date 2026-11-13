import 'dotenv/config';
import path from 'path';

const bool = (v: string | undefined, def = false): boolean =>
  v === undefined || v.trim() === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 3456),
  /** In Docker usare 0.0.0.0 (la porta è comunque pubblicata solo su 127.0.0.1 dal compose). */
  host: process.env.HOST || '127.0.0.1',
  mock: bool(process.env.MOCK_MODE, false),

  /** Dietro un reverse proxy HTTPS: legge X-Forwarded-* (req.secure, req.ip). */
  trustProxy: bool(process.env.TRUST_PROXY, false),

  accessPin: process.env.APP_ACCESS_PIN || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  /**
   * Cookie "Secure": 'auto' (default) = solo se la richiesta è HTTPS (req.secure, che con TRUST_PROXY
   * legge X-Forwarded-Proto dal proxy). Così funziona sia in HTTP locale sia dietro HTTPS.
   * COOKIE_SECURE=true/false forza il valore.
   */
  cookieSecure: ((v) => (v === undefined || v.trim() === '' || v.trim() === 'auto' ? 'auto' : bool(v)))(
    process.env.COOKIE_SECURE,
  ) as boolean | 'auto',

  staticDir: process.env.STATIC_DIR || path.resolve(__dirname, '../../web/dist'),

  sophos: {
    clientId: process.env.SOPHOS_CLIENT_ID || '',
    clientSecret: process.env.SOPHOS_CLIENT_SECRET || '',
    tokenUrl: process.env.SOPHOS_TOKEN_URL || 'https://id.sophos.com/api/v2/oauth2/token',
    whoamiUrl: process.env.SOPHOS_WHOAMI_URL || 'https://api.central.sophos.com/whoami/v1',
    /** Obbligatorio solo se le credenziali sono Partner/Organization: tenant da interrogare. */
    tenantId: process.env.SOPHOS_TENANT_ID || '',
    /** Endpoint Cases GraphQL (unico per tutti i tenant, da developer.sophos.com). */
    graphqlUrl: process.env.SOPHOS_GRAPHQL_URL || 'https://api.taegis.sophos.com/graphql',
    /** ID autore (authorId) da considerare "tuoi" nella chat, separati da virgola. Vedi README. */
    myAuthorIds: (process.env.SOPHOS_MY_AUTHOR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.accessPin) errors.push('APP_ACCESS_PIN mancante: impostalo nel file .env');
  if (!config.mock && (!config.sophos.clientId || !config.sophos.clientSecret)) {
    errors.push('SOPHOS_CLIENT_ID / SOPHOS_CLIENT_SECRET mancanti (oppure usa MOCK_MODE=true)');
  }
  return errors;
}
