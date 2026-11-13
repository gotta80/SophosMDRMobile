/** Modello dati interno (normalizzato) esposto al frontend. */

export type CaseStatus = 'new' | 'investigating' | 'actionRequired' | 'onHold' | 'resolved';
export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low';

export const CASE_STATUSES: CaseStatus[] = ['new', 'investigating', 'actionRequired', 'onHold', 'resolved'];
export const CASE_SEVERITIES: CaseSeverity[] = ['critical', 'high', 'medium', 'low'];

export interface Entity {
  id: string;
  type: 'host' | 'user' | 'other';
  name: string;
  /** es. stato di isolamento dell'host: "ISOLATED" / "NOT ISOLATED" */
  detail?: string;
}

export interface CaseSummary {
  id: string;
  shortId?: string;
  title: string;
  severity: CaseSeverity;
  status: CaseStatus;
  type: string; // activeThreat, managedRisk, ...
  managedBy: string; // es. "Sophos MDR"
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
  author: { name: string; role: 'analyst' | 'customer' | 'system' };
}

export interface CaseDetails extends CaseSummary {
  summary: string;
  /** Markdown "key findings" scritto dagli analisti (solo nel dettaglio) */
  keyFindings?: string;
  entities: Entity[];
  detections: Detection[];
  mitre: MitreTechnique[];
  comments: CaseComment[];
}

export interface CaseFilters {
  statuses?: CaseStatus[];
  severities?: CaseSeverity[];
}
