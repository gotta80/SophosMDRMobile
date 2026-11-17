import { getLang } from './lib/i18n';
import type {
  CaseComment,
  CaseDetails,
  CaseSummary,
  ClassifyInput,
  DashboardData,
  PortfolioItem,
  Reference,
  TenantInfo,
  TenantLicenses,
  AccountHealth,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

/** Selected customer: sent with every request in the X-App-Tenant header. */
let currentTenant = '';
export const setApiTenant = (id: string) => {
  currentTenant = id;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-App-Lang': getLang(), ...(currentTenant ? { 'X-App-Tenant': currentTenant } : {}), ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.retryAfter);
  return body as T;
}

const post = (data: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(data) });
const enc = encodeURIComponent;

export const api = {
  session: () => req<{ authenticated: boolean; mock: boolean }>('/api/session'),
  login: (pin: string) => req<{ ok: true }>('/api/login', post({ pin })),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),

  tenants: () => req<{ tenants: TenantInfo[]; probing: boolean }>('/api/tenants'),
  refreshTenants: () => req<{ ok: true }>('/api/tenants/refresh', post({})),
  licenses: (refresh = false) => req<TenantLicenses>(`/api/licenses${refresh ? '?refresh=1' : ''}`),
  accountHealth: (refresh = false) => req<AccountHealth>(`/api/account-health${refresh ? '?refresh=1' : ''}`),
  portfolio: () => req<{ portfolio: PortfolioItem[] }>('/api/portfolio').then((r) => r.portfolio),

  cases: (status?: string[]) =>
    req<{ cases: CaseSummary[] }>(`/api/cases${status?.length ? `?status=${status.join(',')}` : ''}`).then((r) => r.cases),
  caseDetails: (id: string) => req<{ case: CaseDetails }>(`/api/cases/${enc(id)}`).then((r) => r.case),
  addComment: (id: string, text: string) =>
    req<{ comment: CaseComment }>(`/api/cases/${enc(id)}/comments`, post({ text })).then((r) => r.comment),

  dashboard: (days: number) => req<{ dashboard: DashboardData }>(`/api/dashboard?days=${days}`).then((r) => r.dashboard),
  reference: () => req<{ reference: Reference }>('/api/reference').then((r) => r.reference),
  classify: (id: string, input: ClassifyInput) => req<{ ok: true }>(`/api/cases/${enc(id)}/classify`, post(input)),
  aiCase: (id: string) => req<{ text: string }>(`/api/cases/${enc(id)}/ai`).then((r) => r.text),
  aiDetection: (id: string, detectionId: string) =>
    req<{ text: string }>(`/api/cases/${enc(id)}/ai/detection`, post({ detectionId })).then((r) => r.text),
};
