/** Internal (normalized) data model exposed to the frontend. */

export type CaseStatus = 'new' | 'investigating' | 'actionRequired' | 'onHold' | 'resolved';
export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low';

export const CASE_STATUSES: CaseStatus[] = ['new', 'investigating', 'actionRequired', 'onHold', 'resolved'];
export const CASE_SEVERITIES: CaseSeverity[] = ['critical', 'high', 'medium', 'low'];

export interface Entity {
  id: string;
  type: 'host' | 'user' | 'other';
  name: string;
  /** e.g. host isolation status: "ISOLATED" / "NOT ISOLATED" */
  detail?: string;
}

export interface Ref {
  id: string;
  name: string;
  title: string;
}

export interface CaseSummary {
  id: string;
  shortId?: string;
  verdict?: Ref | null;
  secondaryVerdict?: Ref | null;
  closeReason?: string;
  title: string;
  severity: CaseSeverity;
  status: CaseStatus;
  type: string; // activeThreat, managedRisk, ...
  managedBy: string; // e.g. "Sophos MDR"
  primaryEntity: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface Detection {
  id: string;
  name: string;
  severity: CaseSeverity | null;
  source?: string;
}

export interface MitreTechnique {
  id: string; // T1059.001
  name: string;
  tactic?: string;
}

export interface CaseComment {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; role: 'analyst' | 'customer' | 'colleague' | 'system' };
}

export interface CaseDetails extends CaseSummary {
  summary: string;
  /** Markdown "key findings" written by the analysts (detail only) */
  keyFindings?: string;
  /** IDs of the linked detections (case evidence): needed for the AI analysis */
  detectionIds?: string[];
  /** Timeline (classic cases only: the REST API has no comments, but it has the activity log) */
  activities?: Activity[];
  entities: Entity[];
  detections: Detection[];
  mitre: MitreTechnique[];
  comments: CaseComment[];
}

export interface CaseFilters {
  statuses?: CaseStatus[];
  severities?: CaseSeverity[];
}

/** Tenant reference data for case classification. */
export interface Reference {
  verdicts: Ref[]; // primary verdicts (False Positive, True Positive - Benign/Malicious, Inconclusive)
  secondaryVerdicts: Ref[]; // reasons
  closedStatusId: string | null;
}

export interface ClassifyInput {
  verdictId: string;
  secondaryVerdictId?: string;
  closeReason?: string;
  close: boolean;
}

export interface DashboardData {
  days: number;
  generatedAt: string;
  kpi: {
    totalCases: number;
    actionRequiredCases: number;
    effortHours: number | null; // null on classic cases (not available)
    escalatedCases: number;
    weekendCases: number;
    openCases: number;
  };
  bySeverity: { key: CaseSeverity; count: number }[];
  byVerdict: { title: string; name: string; count: number }[];
  byStatus: { key: CaseStatus; count: number }[];
  daily: { date: string; count: number }[];
  attention: CaseSummary[]; // cases that require action
}

/** What the app can do on a customer: depends on where its cases live (Fusion or Central classic). */
export interface Capabilities {
  comments: boolean;
  classify: boolean;
  ai: boolean;
}

export type TenantKind = 'fusion' | 'classic';
/** Timeline entry of a classic case (from the Sophos Central activity log). */
export interface ActivityChange {
  label: string;
  from?: string;
  to?: string;
}

export interface Activity {
  id: string;
  at: string; // ISO
  who: string;
  kind: 'note' | 'message' | 'status' | 'action' | 'file' | 'created' | 'change' | 'ai' | 'other';
  /** note/message text, or description line */
  text?: string;
  changes?: ActivityChange[];
  /** "minor" entry (internal queues, tags, collaborators...): hidden by default */
  minor?: boolean;
}

/** MDR service level of a customer, derived from its licenses. */
export type MdrLevel = 'mdr' | 'mdr_plus' | 'none';

export interface LicenseItem {
  id: string;
  code: string;
  name: string;
  type: 'term' | 'usage' | 'other';
  /** MDR/MTR product (shown first in the UI) */
  mdr: boolean;
  /** term license already past its end date */
  expired: boolean;
  quantity?: number;
  unlimited?: boolean;
  perpetual?: boolean;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  /** current usage (units in use) when reported */
  usage?: number;
  /** licensed features (Fusion fallback only) */
  features?: string[];
}

export interface TenantLicenses {
  mdr: MdrLevel;
  licenses: LicenseItem[];
  /** where the list came from: REST Licensing API or Fusion GraphQL fallback */
  source: 'rest' | 'graphql';
  fetchedAt: string; // ISO
}
