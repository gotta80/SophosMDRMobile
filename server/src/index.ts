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
  console.error('Invalid configuration:\n - ' + errors.join('\n - '));
  process.exit(1);
}

/** Customer registry: real (Sophos) or demo. */
const reg = config.mock ? mockRegistry : registry;
reg.start();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);

// Security headers
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

// Additional anti-CSRF (besides SameSite=Lax): writes must be JSON.
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

/** Customer selected by the app (X-App-Tenant header); without the header, the default customer. */
async function backendFor(req: Request): Promise<CaseBackend | null> {
  const id = String(req.headers['x-app-tenant'] ?? '').trim();
  return id ? reg.get(id) : reg.first();
}

/** Answers 404/405 if the customer is unavailable or does not support the requested feature. */
async function tenantRoute(
  req: Request,
  res: Response,
  need: keyof Capabilities | 'licenses' | null,
  fn: (api: CaseBackend) => Promise<unknown>,
) {
  const api = await backendFor(req);
  if (!api) return res.status(404).json({ error: 'tenant_unavailable' });
  // customers without case access (licenses only) answer only the licenses route
  if (api.kind === 'licenses' && need !== 'licenses') return res.status(405).json({ error: 'licenses_only' });
  if (need && need !== 'licenses' && !api.capabilities[need]) return res.status(405).json({ error: 'not_supported_classic' });
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

// ---- customers (tenants)
app.get('/api/tenants', requireAuth, (_req, res) => {
  res.json({ tenants: reg.list(), probing: reg.probing, lastRefresh: reg.lastRefresh });
});

/** Re-runs the customer check in the background (e.g. after a migration to Fusion or a new delegation). */
app.post('/api/tenants/refresh', requireAuth, (_req, res) => {
  void reg.refresh();
  res.json({ ok: true });
});

/** Licenses and MDR level of the selected customer (`?refresh=1` bypasses the cache). */
app.get(
  '/api/licenses',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, 'licenses', async (api) => res.json(await api.getLicenses(req.query.refresh === '1'))),
  ),
);

/** Account Health Check scores of the selected customer (`?refresh=1` bypasses the cache). */
app.get(
  '/api/account-health',
  requireAuth,
  wrap((req, res) =>
    tenantRoute(req, res, null, async (api) => res.json(await api.getAccountHealth(req.query.refresh === '1'))),
  ),
);

/** Portfolio view: counts (open / to handle) for every accessible customer. */
app.get(
  '/api/portfolio',
  requireAuth,
  wrap(async (_req, res) => {
    res.json({ portfolio: await reg.portfolio() });
  }),
);

// ---- cases of the selected customer
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

/** Classifies (verdict) and optionally closes the case. Writes to Sophos: requires confirmation on the UI side. */
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

// ------------------------------------------------------------------ static frontend (PWA)
if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
  app.use(
    express.static(config.staticDir, {
      index: false,
      setHeaders(res, file) {
        // sw.js, manifest and index must not be cached aggressively; hashed assets can.
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
  console.warn(`Frontend not found in ${config.staticDir} (API-only mode / dev with Vite).`);
}

// ------------------------------------------------------------------ errors
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof SophosError ? err.status : 500;
  console.error('[error]', err instanceof Error ? err.message : err);
  // Generic message to the client: no internal details.
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err instanceof SophosError ? err.message : 'internal_error',
  });
});

app.listen(config.port, config.host, () => {
  console.log(
    `Sophos MDR Mobile listening on http://${config.host}:${config.port} (mock=${config.mock}, connections=${config.sophos.connections.length}, trustProxy=${config.trustProxy})`,
  );
});
