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
  author: { name: string; role: 'analyst' | 'customer' | 'system' };
}

export interface Detection { id: string; name: string; severity: CaseSeverity | null; source?: string }

export interface CaseDetails extends CaseSummary {
  summary: string;
  keyFindings?: string;
  detectionIds?: string[];
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
    effortHours: number;
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
