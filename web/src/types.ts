export type CaseStatus = 'new' | 'investigating' | 'actionRequired' | 'onHold' | 'resolved';
export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Entity { id: string; type: 'host' | 'user' | 'other'; name: string; detail?: string }

export interface CaseSummary {
  id: string;
  shortId?: string;
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

export interface CaseDetails extends CaseSummary {
  summary: string;
  keyFindings?: string;
  entities: Entity[];
  detections: { id: string; name: string; severity: CaseSeverity | null; source?: string }[];
  mitre: { id: string; name: string; tactic?: string }[];
  comments: CaseComment[];
}
