import type { CaseSeverity, CaseStatus } from '../types';
import { SEVERITY_CLASS, SEVERITY_LABEL, STATUS_CLASS, STATUS_LABEL } from '../lib/format';

export const SeverityBadge = ({ severity }: { severity: CaseSeverity }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_CLASS[severity]}`}>
    {SEVERITY_LABEL[severity]}
  </span>
);

export const StatusText = ({ status }: { status: CaseStatus }) => (
  <span className={`text-xs ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
);
