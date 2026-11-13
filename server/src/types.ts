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
  /** ID delle detection collegate (evidenze del caso): servono per l'analisi AI */
  detectionIds?: string[];
  entities: Entity[];
  detections: Detection[];
  mitre: MitreTechnique[];
  comments: CaseComment[];
}

export interface CaseFilters {
  statuses?: CaseStatus[];
  severities?: CaseSeverity[];
}

/** Dati di riferimento del tenant per la classificazione dei casi. */
export interface Reference {
  verdicts: Ref[]; // verdetti primari (False Positive, True Positive - Benign/Malicious, Inconclusive)
  secondaryVerdicts: Ref[]; // motivazioni
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
  attention: CaseSummary[]; // casi che richiedono azione
}
