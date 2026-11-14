import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type Lang = 'it' | 'en';

const store = new AsyncLocalStorage<Lang>();

/** Language of the current request (X-App-Lang header; default it). */
export const currentLang = (): Lang => store.getStore() ?? 'it';

/** Middleware: sets the language for the whole async chain of the request. */
export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const h = String(req.headers['x-app-lang'] ?? '').toLowerCase();
  store.run(h === 'en' ? 'en' : 'it', next);
}

/** Picks the text in the current language. */
export const pick = <T>(it: T, en: T): T => (currentLang() === 'en' ? en : it);
