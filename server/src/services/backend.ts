import type {
  Capabilities,
  CaseComment,
  CaseDetails,
  CaseFilters,
  CaseSummary,
  ClassifyInput,
  DashboardData,
  Reference,
  TenantKind,
  TenantLicenses,
} from '../types';
import type { Counts } from './sophosClient';

/** Operations on a customer's cases, independent of where they live (Fusion GraphQL or Central classic REST). */
export interface CaseBackend {
  /** 'licenses' = customer without case access: only the licenses can be read */
  readonly kind: TenantKind | 'licenses';
  readonly capabilities: Capabilities;
  getCases(filters: CaseFilters): Promise<CaseSummary[]>;
  getCaseDetails(caseId: string): Promise<CaseDetails | null>;
  addCaseComment(caseId: string, text: string): Promise<CaseComment>;
  getReference(): Promise<Reference>;
  classifyCase(caseId: string, input: ClassifyInput): Promise<void>;
  aiCaseSummary(caseId: string): Promise<string>;
  aiDetection(caseId: string, detectionId: string): Promise<string>;
  getDashboard(days: number): Promise<DashboardData>;
  getCounts(): Promise<Counts>;
  /** Licenses and MDR level of the customer (1 h cache; `force` re-reads). */
  getLicenses(force?: boolean): Promise<TenantLicenses>;
}
