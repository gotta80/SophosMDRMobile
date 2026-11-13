import type { CaseComment, CaseDetails, CaseSummary } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.retryAfter);
  return body as T;
}

export const api = {
  session: () => req<{ authenticated: boolean; mock: boolean }>('/api/session'),
  login: (pin: string) => req<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),
  cases: (status?: string[]) =>
    req<{ cases: CaseSummary[] }>(`/api/cases${status?.length ? `?status=${status.join(',')}` : ''}`).then((r) => r.cases),
  caseDetails: (id: string) => req<{ case: CaseDetails }>(`/api/cases/${encodeURIComponent(id)}`).then((r) => r.case),
  addComment: (id: string, text: string) =>
    req<{ comment: CaseComment }>(`/api/cases/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }).then((r) => r.comment),
};
