import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

const COOKIE = 'mdr_session';
// If SESSION_SECRET is not set, sessions are lost when the container restarts.
const secret = config.sessionSecret || crypto.randomBytes(32).toString('hex');

const hmac = (data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const pinMatches = (pin: string) => !!config.accessPin && safeEqual(pin, config.accessPin);

function createToken(): string {
  const exp = Date.now() + config.sessionDays * 86_400_000;
  return `${exp}.${hmac(String(exp))}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, hmac(exp));
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const secureFor = (req: Request) => (config.cookieSecure === 'auto' ? req.secure : config.cookieSecure);

export function setSessionCookie(req: Request, res: Response): void {
  res.cookie(COOKIE, createToken(), {
    httpOnly: true,
    secure: secureFor(req),
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 86_400_000,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, secure: secureFor(req), sameSite: 'lax', path: '/' });
}

export const isAuthenticated = (req: Request) => tokenValid(readCookie(req, COOKIE));

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

/** Simple in-memory rate limit on login attempts: 5 failures / 15 min per IP. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

export function loginBlocked(ip: string): number {
  const a = attempts.get(ip);
  if (!a || a.resetAt < Date.now()) return 0;
  return a.count >= MAX_ATTEMPTS ? Math.ceil((a.resetAt - Date.now()) / 1000) : 0;
}
export function loginFailed(ip: string): void {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else a.count++;
}
export const loginSucceeded = (ip: string) => void attempts.delete(ip);
