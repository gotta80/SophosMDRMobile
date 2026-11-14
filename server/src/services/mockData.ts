/** Dati mock realistici per MOCK_MODE=true. Stato in memoria: i commenti aggiunti restano fino al riavvio. */
import { currentLang } from '../lang';
import type { CaseComment, CaseDetails, CaseFilters, CaseSummary, ClassifyInput, DashboardData, Reference } from '../types';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const A = (name = 'Sophos MDR Analyst'): CaseComment['author'] => ({ name, role: 'analyst' });
const ME: CaseComment['author'] = { name: 'Tu', role: 'customer' }; // il client mostra 'Tu'/'You' in base al ruolo

const cases: CaseDetails[] = [
  {
    id: '7b0e2c1a-4f5d-4e2a-9a31-0c8f1d2b6a01',
    title: 'Possibile ransomware: cifratura massiva di file su server file',
    severity: 'critical',
    status: 'actionRequired',
    type: 'activeThreat',
    managedBy: 'Sophos MDR',
    primaryEntity: 'SRV-FILE01',
    createdAt: ago(190),
    updatedAt: ago(12),
    summary:
      "Gli analisti MDR hanno rilevato la rinomina massiva di file con estensione .locked su SRV-FILE01, riconducibile a un processo avviato dall'account svc-backup. Il comportamento è coerente con ransomware attivo. Si raccomanda l'isolamento immediato dell'host per prevenire la propagazione sulle share di rete.",
    keyFindings:
      '### Investigation Summary\nRilevata **cifratura massiva** di file su `SRV-FILE01` da parte di un processo avviato da `CORP\\svc-backup`. Raccomandiamo l\'**isolamento immediato** dell\'host.\n\n### Investigation Details\n#### Analysis\n- PowerShell ha eliminato le shadow copy (`vssadmin delete shadows`)\n- Oltre 4.000 file rinominati con estensione `.locked` in 10 minuti\n\n| Indicatore | Valore |\n|---|---|\n| Host | SRV-FILE01 |\n| Account | CORP\\svc-backup |',
    entities: [
      { id: 'h1', type: 'host', name: 'SRV-FILE01' },
      { id: 'u1', type: 'user', name: 'CORP\\svc-backup' },
    ],
    detections: [
      { id: 'd1', name: 'Impact_Ransom_FileEncryption', severity: 'critical', source: 'Endpoint' },
      { id: 'd2', name: 'Exec_Suspicious_PowerShell', severity: 'high', source: 'Endpoint' },
      { id: 'd3', name: 'Defense_Evasion_ShadowCopyDelete', severity: 'high', source: 'Endpoint' },
    ],
    mitre: [
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact' },
      { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution' },
      { id: 'T1490', name: 'Inhibit System Recovery', tactic: 'Impact' },
    ],
    comments: [
      { id: 'c1', author: { name: 'Sophos MDR', role: 'system' }, createdAt: ago(190), body: 'Caso creato automaticamente da detection ad alta priorità.' },
      { id: 'c2', author: A('Elena R. (Sophos MDR)'), createdAt: ago(60), body: "Abbiamo avviato l'analisi su SRV-FILE01. Rileviamo cifratura attiva da parte di un processo sospetto avviato da svc-backup." },
      { id: 'c3', author: A('Elena R. (Sophos MDR)'), createdAt: ago(12), body: "⚠️ Azione richiesta: confermi che possiamo isolare SRV-FILE01 dalla rete? L'isolamento interrompe l'accesso alle share ma blocca la propagazione. Attendiamo la tua conferma." },
    ],
  },
  {
    id: '3c9d8e77-1b2a-4c55-8d10-5e6f7a8b9c02',
    title: 'Accesso sospetto da geolocalizzazione anomala',
    severity: 'high',
    status: 'investigating',
    type: 'activeThreat',
    managedBy: 'Sophos MDR',
    primaryEntity: 'LAPTOP-MROSSI',
    createdAt: ago(420),
    updatedAt: ago(47),
    summary: "Login riuscito per m.rossi da IP in paese non abituale, seguito da download di dati sensibili. Gli analisti stanno correlando l'attività con altri eventi di autenticazione.",
    entities: [
      { id: 'h2', type: 'host', name: 'LAPTOP-MROSSI' },
      { id: 'u2', type: 'user', name: 'm.rossi@azienda.it' },
    ],
    detections: [{ id: 'd4', name: 'Identity_ImpossibleTravel', severity: 'high', source: 'Identity' }],
    mitre: [{ id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access' }],
    comments: [
      { id: 'c4', author: A('Luca B. (Sophos MDR)'), createdAt: ago(47), body: 'Stiamo verificando i log di autenticazione. Puoi confermare se m.rossi è in viaggio?' },
    ],
  },
  {
    id: '9a1f4b3c-2d6e-4f70-b8a9-1c2d3e4f5a03',
    title: 'Strumento di accesso remoto non autorizzato rilevato',
    severity: 'medium',
    status: 'new',
    type: 'managedRisk',
    managedBy: 'Sophos MDR',
    primaryEntity: 'PC-AMMINISTRAZIONE',
    createdAt: ago(25),
    updatedAt: ago(25),
    summary: 'Rilevata installazione di AnyDesk non presente nella baseline autorizzata.',
    entities: [{ id: 'h3', type: 'host', name: 'PC-AMMINISTRAZIONE' }],
    detections: [{ id: 'd5', name: 'PUA_RemoteAccessTool', severity: 'medium', source: 'Endpoint' }],
    mitre: [{ id: 'T1219', name: 'Remote Access Software', tactic: 'Command and Control' }],
    comments: [],
  },
  {
    id: '5d2e6f80-3a4b-4c91-9e0f-7a8b9c0d1e04',
    title: 'Movimento laterale tramite PsExec',
    severity: 'high',
    status: 'onHold',
    type: 'activeThreat',
    managedBy: 'Sophos MDR',
    primaryEntity: 'SRV-APP02',
    createdAt: ago(2900),
    updatedAt: ago(1500),
    summary: 'Uso di PsExec da SRV-APP02 verso più host. Caso in attesa di feedback sul fatto che si tratti di attività amministrativa pianificata.',
    entities: [{ id: 'h4', type: 'host', name: 'SRV-APP02' }],
    detections: [{ id: 'd6', name: 'LateralMovement_PsExec', severity: 'high', source: 'Endpoint' }],
    mitre: [{ id: 'T1570', name: 'Lateral Tool Transfer', tactic: 'Lateral Movement' }],
    comments: [
      { id: 'c5', author: A('Elena R. (Sophos MDR)'), createdAt: ago(2800), body: "Possiamo ricondurre l'attività a una manutenzione pianificata?" },
      { id: 'c6', author: ME, createdAt: ago(1500), body: 'Verifico con il team infrastruttura e ti aggiorno. @sophos' },
    ],
  },
  {
    id: '1e3f5a7c-9b0d-4e2f-a4c6-8d0e2f4a6b05',
    title: 'Malware commodity bloccato e rimosso',
    severity: 'low',
    status: 'resolved',
    type: 'managedRisk',
    managedBy: 'Sophos MDR',
    primaryEntity: 'LAPTOP-VERDI',
    createdAt: ago(5800),
    updatedAt: ago(4300),
    summary: 'Trojan generico intercettato da Intercept X e rimosso automaticamente. Nessuna azione ulteriore.',
    entities: [{ id: 'h5', type: 'host', name: 'LAPTOP-VERDI' }],
    detections: [{ id: 'd7', name: 'Mal/Generic-S', severity: 'low', source: 'Endpoint' }],
    mitre: [{ id: 'T1204', name: 'User Execution', tactic: 'Execution' }],
    comments: [{ id: 'c7', author: A('Luca B. (Sophos MDR)'), createdAt: ago(4300), body: 'Minaccia neutralizzata. Chiudiamo il caso.' }],
  },
];

/** Traduzione inglese dei contenuti demo (per id caso / id commento). Gli ID e i dati tecnici restano uguali. */
const EN_CASES: Record<string, { title: string; summary: string; keyFindings?: string }> = {
  '7b0e2c1a-4f5d-4e2a-9a31-0c8f1d2b6a01': {
    title: 'Possible ransomware: mass file encryption on file server',
    summary:
      'MDR analysts detected mass renaming of files with the .locked extension on SRV-FILE01, traced back to a process launched by the svc-backup account. The behavior is consistent with active ransomware. Immediate isolation of the host is recommended to prevent propagation to network shares.',
    keyFindings:
      '### Investigation Summary\n**Mass encryption** of files detected on `SRV-FILE01` by a process launched by `CORP\\svc-backup`. We recommend **isolating the host immediately**.\n\n### Investigation Details\n#### Analysis\n- PowerShell deleted the shadow copies (`vssadmin delete shadows`)\n- Over 4,000 files renamed with the `.locked` extension within 10 minutes\n\n| Indicator | Value |\n|---|---|\n| Host | SRV-FILE01 |\n| Account | CORP\\svc-backup |',
  },
  '3c9d8e77-1b2a-4c55-8d10-5e6f7a8b9c02': {
    title: 'Suspicious sign-in from an unusual location',
    summary: 'Successful login for m.rossi from an IP in an unusual country, followed by a download of sensitive data. Analysts are correlating the activity with other authentication events.',
  },
  '9a1f4b3c-2d6e-4f70-b8a9-1c2d3e4f5a03': {
    title: 'Unauthorized remote access tool detected',
    summary: 'Installation of AnyDesk detected, which is not in the authorized baseline.',
  },
  '5d2e6f80-3a4b-4c91-9e0f-7a8b9c0d1e04': {
    title: 'Lateral movement via PsExec',
    summary: 'PsExec used from SRV-APP02 against multiple hosts. Case on hold pending feedback on whether this is scheduled administrative activity.',
  },
  '1e3f5a7c-9b0d-4e2f-a4c6-8d0e2f4a6b05': {
    title: 'Commodity malware blocked and removed',
    summary: 'Generic trojan intercepted by Intercept X and removed automatically. No further action needed.',
  },
};
const EN_COMMENTS: Record<string, string> = {
  c1: 'Case created automatically from a high-priority detection.',
  c2: 'We started the analysis on SRV-FILE01. We see active encryption by a suspicious process launched by svc-backup.',
  c3: '⚠️ Action required: can you confirm that we may isolate SRV-FILE01 from the network? Isolation cuts access to the shares but stops the spread. We are waiting for your confirmation.',
  c4: 'We are checking the authentication logs. Can you confirm whether m.rossi is traveling?',
  c5: 'Can we trace the activity back to scheduled maintenance?',
  c6: 'I will check with the infrastructure team and get back to you. @sophos',
  c7: 'Threat neutralized. We are closing the case.',
};
/** Applica la lingua corrente (default italiano: i dati originali). */
function loc<T extends CaseSummary | CaseDetails>(c: T): T {
  if (currentLang() !== 'en') return c;
  const o = EN_CASES[c.id];
  const out: any = { ...c, ...(o ? { title: o.title, summary: o.summary, ...(o.keyFindings && 'keyFindings' in c ? { keyFindings: o.keyFindings } : {}) } : {}) };
  if ('comments' in c) out.comments = c.comments.map((m) => (EN_COMMENTS[m.id] ? { ...m, body: EN_COMMENTS[m.id] } : m));
  return out;
}

const summarize = ({ summary, keyFindings, detectionIds, entities, detections, mitre, comments, ...s }: CaseDetails): CaseSummary => s;

export const mockStore = {
  list(filters: CaseFilters): CaseSummary[] {
    return cases
      .filter((c) => !filters.statuses?.length || filters.statuses.includes(c.status))
      .filter((c) => !filters.severities?.length || filters.severities.includes(c.severity))
      .map(summarize)
      .map(loc)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  },
  get(id: string): CaseDetails | null {
    const c = cases.find((x) => x.id === id);
    return c ? loc({ ...c, detectionIds: c.detections.map((d) => d.id) }) : null;
  },
  addComment(id: string, text: string): CaseComment | null {
    const c = cases.find((x) => x.id === id);
    if (!c) return null;
    const comment: CaseComment = { id: `m${Date.now()}`, author: ME, createdAt: new Date().toISOString(), body: text };
    c.comments.push(comment);
    c.updatedAt = comment.createdAt;
    // Se il cliente risponde a un caso "actionRequired", lo riportiamo in investigazione.
    if (c.status === 'actionRequired') c.status = 'investigating';
    return comment;
  },

  getReference(): Reference {
    return REF;
  },

  classify(id: string, input: ClassifyInput): boolean {
    const c = cases.find((x) => x.id === id);
    if (!c) return false;
    c.verdict = REF.verdicts.find((v) => v.id === input.verdictId) ?? null;
    c.secondaryVerdict = REF.secondaryVerdicts.find((v) => v.id === input.secondaryVerdictId) ?? null;
    c.closeReason = input.closeReason;
    if (input.close) c.status = 'resolved';
    c.updatedAt = new Date().toISOString();
    return true;
  },

  aiCaseSummary(id: string): string | null {
    const c = cases.find((x) => x.id === id);
    return c
      ? `The Case \`${c.shortId ?? c.id}\` (${loc(c).title}) concerns host **${c.primaryEntity}**. Analysts observed the activity listed in the detections and found no evidence of lateral movement. Recommended: validate the activity with the asset owner. _(Mock AI summary)_`
      : null;
  },

  aiDetection(id: string, detectionId: string): string | null {
    const c = cases.find((x) => x.id === id);
    if (!c?.detections.some((d) => d.id === detectionId)) return null;
    return `- The detection \`${detectionId}\` shows a process launched under the user account listed in the case.\n- No malicious reputation was found for the observed destinations.\n\nRecommended triage actions:\n- Confirm the activity with the user.\n- Review related process lineage. _(Mock AI analysis)_`;
  },

  dashboard(days: number): DashboardData {
    const since = Date.now() - days * 86_400_000;
    const list = cases.filter((c) => +new Date(c.createdAt) >= since);
    const sev = (['critical', 'high', 'medium', 'low'] as const).map((key) => ({ key, count: list.filter((c) => c.severity === key).length }));
    const bin = days > 31 ? 7 : 1;
    const nBins = Math.ceil(days / bin);
    const end = Date.now();
    const daily = Array.from({ length: nBins }, (_, i) => ({
      date: new Date(end - (nBins - i) * bin * 86_400_000).toISOString().slice(0, 10),
      count: 0,
    }));
    for (const c of list) {
      const idx = Math.min(nBins - 1, Math.max(0, Math.floor((+new Date(c.createdAt) - (end - nBins * bin * 86_400_000)) / (bin * 86_400_000))));
      daily[idx].count++;
    }
    const byVerdict = [
      { title: 'True Positive - Benign', name: 'true_positive_benign', count: 3 },
      { title: 'False Positive', name: 'false_positive', count: 1 },
      { title: currentLang() === 'en' ? 'No verdict' : 'Senza verdetto', name: 'none', count: list.filter((c) => c.status !== 'resolved').length },
    ];
    return {
      days,
      generatedAt: new Date().toISOString(),
      kpi: {
        totalCases: list.length,
        actionRequiredCases: cases.filter((c) => c.status === 'actionRequired').length,
        effortHours: 12.5,
        escalatedCases: Math.max(0, list.length - 1),
        weekendCases: 1,
        openCases: cases.filter((c) => c.status !== 'resolved').length,
      },
      bySeverity: sev,
      byVerdict,
      byStatus: (['actionRequired', 'new', 'investigating', 'onHold', 'resolved'] as const).map((key) => ({ key, count: list.filter((c) => c.status === key).length })),
      daily,
      attention: cases.filter((c) => c.status === 'actionRequired').map(summarize).map(loc),
    };
  },
};

const REF: Reference = {
  verdicts: [
    { id: 'v-fp', name: 'false_positive', title: 'False Positive' },
    { id: 'v-tpb', name: 'true_positive_benign', title: 'True Positive - Benign' },
    { id: 'v-tpm', name: 'true_positive_malicious', title: 'True Positive - Malicious' },
    { id: 'v-inc', name: 'inconclusive', title: 'Inconclusive' },
  ],
  secondaryVerdicts: [
    { id: 's-ns', name: 'not_set', title: 'Not Set' },
    { id: 's-ofp', name: 'other_false_positive', title: 'Other: False Positive' },
    { id: 's-ob', name: 'other_benign', title: 'Other: Benign Activity' },
    { id: 's-ua', name: 'user_activity_unconfirmed', title: 'User activity (unconfirmed)' },
  ],
  closedStatusId: 'closed',
};
