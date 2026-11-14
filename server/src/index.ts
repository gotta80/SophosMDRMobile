import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config, validateConfig } from './config';
import { langMiddleware } from './lang';
import {
  clearSessionCookie,
  isAuthenticated,
  loginBlocked,
  loginFailed,
  loginSucceeded,
  pinMatches,
  requireAuth,
  setSessionCookie,
} from './auth';
import {
  CASE_SEVERITIES,
  CASE_STATUSES,
  type Capabilities,
  type CaseFilters,
  type CaseSeverity,
  type CaseStatus,
  type ClassifyInput,
} from './types';
import type { CaseBackend } from './services/backend';
import { mockRegistry } from './services/mockBackend';
import { registry } from './services/registry';
import { SophosError } from './services/sophosConnection';

const errors = validateConfig();
if (errors.length) {
  console.error('Configurazione non valida:\n - ' + errors.join('\n - '));
  process.exit(1);
}

/** Registro dei clienti: reale (Sophos) o demo. */
const reg = config.mock ? mockRegistry : registry;
reg.start();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);

// Header di sicurezza
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

app.use(langMiddleware);
app.use(express.json({ limit: '32kb' }));

// Anti-CSRF aggiuntivo (oltre a SameSite=Lax): le scritture devono essere JSON.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return res.status(415).json({ error: 'content-type must be application/json' });
  }
  next();
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Cliente scelto dall'app (header X-App-Tenant); senza header, il cliente di default. */
async function backendFor(req: Request): Promise<CaseBackend | null> {
  const id = String(req.headers['x-app-tenant'] ?? '').trim();
  return id ? reg.get(id) : reg.first();
}

/** Risponde 404/405 se il cliente non è disponibile o non supporta la funzione richiesta. */
async function tenantRoute(
  req: Request,
  res: Response,
  need: keyof Capabilities | null,
  fn: (api: CaseBackend) => Promise<unknown>,
) {
  const api = await backendFor(req);
  if (!api) return res.status(404).json({ error: 'tenant_unavailable' });
  if (need && !api.capabilities[need]) return res.status(405).json({ error: 'not_supported_classic' });
  return fn(api);
}

// ------------------------------------------------------------------ API
app.get('/api/health', (_req, res) => res.json({ ok: true, mock: config.mock }));

app.get('/api/session', (req, res) => res.json({ authenticated: isAuthenticated(req), mock: config.mock }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const wait = loginBlocked(ip);
  if (wait) return res.status(429).json({ error: 'too_many_attempts', retryAfter: wait });
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!pinMatches(pin)) {
    loginFailed(ip);
    return res.status(401).json({ error: 'invalid_pin' });
  }
  loginSucceeded(ip);
  setSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// ---- clienti (tenant)
app.get('/api/tenants', requireAuth, (_req, res) => {
  res.json({ tenants: reg.list(), probing: reg.probing, lastRefresh: reg.lastRefresh });
});

/** Rilancia la verifica dei clienti in background (es. dopo una migrazione a Fusion o una nuova delega). */
app.post('/api/tenants/refresh', requireAuth, (_req, res) => {
  void reg.refresh();
  res.json({ ok: true });
});

/** Vista portafoglio: conteggi (aperti / da gestire) per ogni cliente accessibile. */
app.get(
  '/api/portfolio',
  requireAuth,
  wrap(async (_req, res) => {
    res.json({ portfolio: await reg.portfolio() });
  }),
);

// ---- casi del cliente selezionato
const parseList = <T extends string>(raw: unknown, allowed: T[]): T[] | undefined => {
  if (typeof raw !== 'string' || !raw) return undefined;
  const items = raw.split(',').filter((x): x is T => (allowed as string[]).includes(x));
  return items.length ? items : undefined;
};

app.get(
  '/api/cases',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, null, async (api) => {
      const filters: CaseFilters = {
        statuses: parseList<CaseStatus>(req.query.status, CASE_STATUSES),
        severities: parseList<CaseSeverity>(req.query.severity, CASE_SEVERITIES),
      };
      res.json({ cases: await api.getCases(filters) });
    }),
  ),
);

app.get(
  '/api/cases/:id',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, null, async (api) => {
      const c = await api.getCaseDetails(String(req.params.id));
      if (!c) return res.status(404).json({ error: 'not_found' });
      res.json({ case: c });
    }),
  ),
);

app.post(
  '/api/cases/:id/comments',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, 'comments', async (api) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text || text.length > 5000) return res.status(400).json({ error: 'invalid_text' });
      res.status(201).json({ comment: await api.addCaseComment(String(req.params.id), text) });
    }),
  ),
);

app.get(
  '/api/dashboard',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, null, async (api) => {
      const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
      res.json({ dashboard: await api.getDashboard(days) });
    }),
  ),
);

app.get(
  '/api/reference',
  requireAuth,
  wrap((req, res) => tenantRoute(req, res, 'classify', async (api) => res.json({ reference: await api.getReference() }))),
);

/** Classifica (verdetto) e opzionalmente chiude il caso. Scrive su Sophos: richiede conferma lato UI. */
app.post(
  '/api/cases/:id/classify',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, 'classify', async (api) => {
      const b = req.body ?? {};
      const input: ClassifyInput = {
        verdictId: typeof b.verdictId === 'string' ? b.verdictId : '',
        secondaryVerdictId: typeof b.secondaryVerdictId === 'string' && b.secondaryVerdictId ? b.secondaryVerdictId : undefined,
        closeReason: typeof b.closeReason === 'string' && b.closeReason.trim() ? b.closeReason.trim().slice(0, 1000) : undefined,
        close: b.close === true,
      };
      if (!input.verdictId) return res.status(400).json({ error: 'verdict_required' });
      await api.classifyCase(String(req.params.id), input);
      res.json({ ok: true });
    }),
  ),
);

app.get(
  '/api/cases/:id/ai',
  requireAuth,
  wrap((req, res) => tenantRoute(req, res, 'ai', async (api) => res.json({ text: await api.aiCaseSummary(String(req.params.id)) }))),
);

app.post(
  '/api/cases/:id/ai/detection',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, 'ai', async (api) => {
      const detectionId = typeof req.body?.detectionId === 'string' ? req.body.detectionId : '';
      if (!detectionId) return res.status(400).json({ error: 'detection_required' });
      res.json({ text: await api.aiDetection(String(req.params.id), detectionId) });
    }),
  ),
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ------------------------------------------------------------------ frontend statico (PWA)
if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
  app.use(
    express.static(config.staticDir, {
      index: false,
      setHeaders(res, file) {
        // sw.js, manifest e index non vanno in cache aggressiva; gli asset hashed sì.
        if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.staticDir, 'index.html'));
  });
} else {
  console.warn(`Frontend non trovato in ${config.staticDir} (modalità solo API / dev con Vite).`);
}

// ------------------------------------------------------------------ errori
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof SophosError ? err.status : 500;
  console.error('[error]', err instanceof Error ? err.message : err);
  // Messaggio generico al client: niente dettagli interni.
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err instanceof SophosError ? err.message : 'internal_error',
  });
});

app.listen(config.port, config.host, () => {
  console.log(
    `Sophos MDR Mobile in ascolto su http://${config.host}:${config.port} (mock=${config.mock}, connessioni=${config.sophos.connections.length}, trustProxy=${config.trustProxy})`,
  );
});
