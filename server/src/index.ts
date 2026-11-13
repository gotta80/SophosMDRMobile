import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config, validateConfig } from './config';
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
import { CASE_SEVERITIES, CASE_STATUSES, type CaseFilters, type CaseSeverity, type CaseStatus, type ClassifyInput } from './types';
import { mockStore } from './services/mockData';
import { SophosError, sophosClient } from './services/sophosClient';

const errors = validateConfig();
if (errors.length) {
  console.error('Configurazione non valida:\n - ' + errors.join('\n - '));
  process.exit(1);
}

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

const parseList = <T extends string>(raw: unknown, allowed: T[]): T[] | undefined => {
  if (typeof raw !== 'string' || !raw) return undefined;
  const items = raw.split(',').filter((x): x is T => (allowed as string[]).includes(x));
  return items.length ? items : undefined;
};

app.get(
  '/api/cases',
  requireAuth,
  wrap(async (req, res) => {
    const filters: CaseFilters = {
      statuses: parseList<CaseStatus>(req.query.status, CASE_STATUSES),
      severities: parseList<CaseSeverity>(req.query.severity, CASE_SEVERITIES),
    };
    res.json({ cases: config.mock ? mockStore.list(filters) : await sophosClient.getCases(filters) });
  }),
);

app.get(
  '/api/cases/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const c = config.mock ? mockStore.get(id) : await sophosClient.getCaseDetails(id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    res.json({ case: c });
  }),
);

app.post(
  '/api/cases/:id/comments',
  requireAuth,
  wrap(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 5000) return res.status(400).json({ error: 'invalid_text' });
    const id = String(req.params.id);
    const comment = config.mock ? mockStore.addComment(id, text) : await sophosClient.addCaseComment(id, text);
    if (!comment) return res.status(404).json({ error: 'not_found' });
    res.status(201).json({ comment });
  }),
);

// ---- dashboard, riferimenti, classificazione e spiegazioni AI
app.get(
  '/api/dashboard',
  requireAuth,
  wrap(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    res.json({ dashboard: config.mock ? mockStore.dashboard(days) : await sophosClient.getDashboard(days) });
  }),
);

app.get(
  '/api/reference',
  requireAuth,
  wrap(async (_req, res) => {
    res.json({ reference: config.mock ? mockStore.getReference() : await sophosClient.getReference() });
  }),
);

/** Classifica (verdetto) e opzionalmente chiude il caso. Scrive su Sophos: richiede conferma lato UI. */
app.post(
  '/api/cases/:id/classify',
  requireAuth,
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const input: ClassifyInput = {
      verdictId: typeof b.verdictId === 'string' ? b.verdictId : '',
      secondaryVerdictId: typeof b.secondaryVerdictId === 'string' && b.secondaryVerdictId ? b.secondaryVerdictId : undefined,
      closeReason: typeof b.closeReason === 'string' && b.closeReason.trim() ? b.closeReason.trim().slice(0, 1000) : undefined,
      close: b.close === true,
    };
    if (!input.verdictId) return res.status(400).json({ error: 'verdict_required' });
    const id = String(req.params.id);
    if (config.mock) {
      if (!mockStore.classify(id, input)) return res.status(404).json({ error: 'not_found' });
    } else {
      await sophosClient.classifyCase(id, input);
    }
    res.json({ ok: true });
  }),
);

app.get(
  '/api/cases/:id/ai',
  requireAuth,
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const text = config.mock ? mockStore.aiCaseSummary(id) : await sophosClient.aiCaseSummary(id);
    if (text === null) return res.status(404).json({ error: 'not_found' });
    res.json({ text });
  }),
);

app.post(
  '/api/cases/:id/ai/detection',
  requireAuth,
  wrap(async (req, res) => {
    const detectionId = typeof req.body?.detectionId === 'string' ? req.body.detectionId : '';
    if (!detectionId) return res.status(400).json({ error: 'detection_required' });
    const id = String(req.params.id);
    const text = config.mock ? mockStore.aiDetection(id, detectionId) : await sophosClient.aiDetection(id, detectionId);
    if (text === null) return res.status(404).json({ error: 'not_found' });
    res.json({ text });
  }),
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
  console.log(`Sophos MDR Mobile in ascolto su http://${config.host}:${config.port} (mock=${config.mock}, trustProxy=${config.trustProxy})`);
});
