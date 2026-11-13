/** Dati mock realistici per MOCK_MODE=true. Stato in memoria: i commenti aggiunti restano fino al riavvio. */
import type { CaseComment, CaseDetails, CaseFilters, CaseSummary } from '../types';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const A = (name = 'Sophos MDR Analyst'): CaseComment['author'] => ({ name, role: 'analyst' });
const ME: CaseComment['author'] = { name: 'Tu', role: 'customer' };

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

const summarize = ({ summary, keyFindings, entities, detections, mitre, comments, ...s }: CaseDetails): CaseSummary => s;

export const mockStore = {
  list(filters: CaseFilters): CaseSummary[] {
    return cases
      .filter((c) => !filters.statuses?.length || filters.statuses.includes(c.status))
      .filter((c) => !filters.severities?.length || filters.severities.includes(c.severity))
      .map(summarize)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  },
  get(id: string): CaseDetails | null {
    return cases.find((c) => c.id === id) ?? null;
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
};
