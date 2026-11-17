export type CaseStatus = 'new' | 'investigating' | 'actionRequired' | 'onHold' | 'resolved';
export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Entity { id: string; type: 'host' | 'user' | 'other'; name: string; detail?: string }

export interface Ref { id: string; name: string; title: string }

export interface CaseSummary {
  id: string;
  shortId?: string;
  verdict?: Ref | null;
  secondaryVerdict?: Ref | null;
  closeReason?: string;
  title: string;
  severity: CaseSeverity;
  status: CaseStatus;
  type: string;
  managedBy: string;
  primaryEntity: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseComment {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; role: 'analyst' | 'customer' | 'colleague' | 'system' };
}

export interface Detection { id: string; name: string; severity: CaseSeverity | null; source?: string }

export interface CaseDetails extends CaseSummary {
  summary: string;
  keyFindings?: string;
  detectionIds?: string[];
  /** Timeline (classic cases only: the REST API has no comments, but it has the activity log) */
  activities?: Activity[];
  entities: Entity[];
  detections: Detection[];
  mitre: { id: string; name: string; tactic?: string }[];
  comments: CaseComment[];
}

export interface Reference {
  verdicts: Ref[];
  secondaryVerdicts: Ref[];
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
    effortHours: number | null;
    escalatedCases: number;
    weekendCases: number;
    openCases: number;
  };
  bySeverity: { key: CaseSeverity; count: number }[];
  byVerdict: { title: string; name: string; count: number }[];
  byStatus: { key: CaseStatus; count: number }[];
  daily: { date: string; count: number }[];
  attention: CaseSummary[];
}

export interface Capabilities { comments: boolean; classify: boolean; ai: boolean }
export type TenantKind = 'fusion' | 'classic';

export interface TenantInfo {
  id: string;
  name: string;
  region?: string;
  status: 'ok' | 'unavailable' | 'unknown';
  kind?: TenantKind;
  capabilities?: Capabilities;
  reason?: 'access_denied' | 'no_service' | 'error';
  caseCount?: number;
  mdr?: MdrLevel;
  /** 'licenses' = no case access: only the Licenses tab is available */
  mode?: 'full' | 'licenses';
  /** active licenses (not expired, seats in use); 0 = inactive customer */
  activeLicenses?: number;
}

export type MdrLevel = 'mdr' | 'mdr_plus' | 'none';

export interface LicenseItem {
  id: string;
  code: string;
  name: string;
  type: 'term' | 'usage' | 'other';
  mdr: boolean;
  expired: boolean;
  quantity?: number;
  unlimited?: boolean;
  perpetual?: boolean;
  startDate?: string;
  endDate?: string;
  usage?: number;
  features?: string[];
}

export interface TenantLicenses {
  mdr: MdrLevel;
  licenses: LicenseItem[];
  source: 'rest' | 'graphql';
  fetchedAt: string;
}

export interface PortfolioItem extends TenantInfo {
  counts?: { total: number; open: number; actionRequired: number };
}

export interface ActivityChange { label: string; from?: string; to?: string }
export interface Activity {
  id: string;
  at: string;
  who: string;
  kind: 'note' | 'message' | 'status' | 'action' | 'file' | 'created' | 'change' | 'ai' | 'other';
  text?: string;
  changes?: ActivityChange[];
  minor?: boolean;
}
