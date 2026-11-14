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
} from '../types';
import type { Counts } from './sophosClient';

/** Operazioni sui casi di un cliente, indipendenti da dove vivono (Fusion GraphQL o Central classic REST). */
export interface CaseBackend {
  readonly kind: TenantKind;
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
}
