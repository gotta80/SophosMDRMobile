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

/**
 * User of a PIN: "user1", "user2"... by position in APP_ACCESS_PIN; null if it is not a configured PIN.
 * Every PIN is compared, so the time does not reveal which one matched.
 */
export function pinUser(pin: string): string | null {
  let found: string | null = null;
  config.accessPins.forEach((p, i) => {
    if (safeEqual(pin, p) && found === null) found = `user${i + 1}`;
  });
  return found;
}

/** Session token: `<expiry>.<user>.<signature>` (older tokens `<expiry>.<signature>` are still accepted, user "unknown"). */
function createToken(user: string): string {
  const exp = Date.now() + config.sessionDays * 86_400_000;
  return `${exp}.${user}.${hmac(`${exp}.${user}`)}`;
}

/** The user of a valid token, or null. */
function tokenUser(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  const [exp] = parts;
  if (!exp || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  if (parts.length === 2) return safeEqual(parts[1], hmac(exp)) ? 'unknown' : null;
  if (parts.length === 3 && /^user\d+$/.test(parts[1])) return safeEqual(parts[2], hmac(`${exp}.${parts[1]}`)) ? parts[1] : null;
  return null;
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

export function setSessionCookie(req: Request, res: Response, user: string): void {
  res.cookie(COOKIE, createToken(user), {
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

/** User of the session of the request ('user1'...), or null when not signed in. */
export const sessionUser = (req: Request) => tokenUser(readCookie(req, COOKIE));
export const isAuthenticated = (req: Request) => sessionUser(req) !== null;

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
