import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type Lang = 'it' | 'en';

const store = new AsyncLocalStorage<Lang>();

/** Lingua della richiesta corrente (header X-App-Lang; default it). */
export const currentLang = (): Lang => store.getStore() ?? 'it';

/** Middleware: imposta la lingua per tutta la catena asincrona della richiesta. */
export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const h = String(req.headers['x-app-lang'] ?? '').toLowerCase();
  store.run(h === 'en' ? 'en' : 'it', next);
}

/** Sceglie il testo nella lingua corrente. */
export const pick = <T>(it: T, en: T): T => (currentLang() === 'en' ? en : it);
