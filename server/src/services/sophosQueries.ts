/**
 * Query / mutation GraphQL per Sophos Cases GraphQL (schema cases-v2) + normalizzatori.
 * Fonte: https://developer.sophos.com/graphql/cases-v2/  (schema: /assets/graphql/cases-v2.graphql)
 * Endpoint: POST https://api.taegis.sophos.com/graphql  (header Authorization + X-Tenant-ID)
 *
 * Verificato dal documento SDL: root fields cases/case/caseComments, mutation addCaseComment,
 * campi di `Case` (severity è Int!: 2 Info, 4 Low, 6 Medium, 8 High, 10 Critical).
 *
 * NON verificato (da controllare con una chiamata reale):
 *  - sintassi dei filtri CQL (qui NON usata: filtriamo/ordiniamo lato server Node);
 *  - nomi di primaryStatus/secondaryStatus (sono per-tenant: la mappatura è in toStatus());
 *  - `CaseArguments { id }` per la query `case`;
 *  - risposta di `caseComments` (campo `comments`);
 *  - come identificare un analista MDR: lo schema non ha un flag -> vedi SOPHOS_MY_AUTHOR_IDS.
 * Lo schema NON espone MITRE, hosts/utenti né detection come liste sul tipo Case (solo conteggi;
 * le liste stanno in `caseEvidence`, i cui sotto-campi non sono ancora mappati qui: vedi Q_CASE_EVIDENCE_TODO).
 */
import type {
  CaseComment,
  CaseDetails,
  CaseSeverity,
  CaseStatus,
  CaseSummary,
  Detection,
  Entity,
  MitreTechnique,
} from '../types';

// ---------------------------------------------------------------- GraphQL documents

const CASE_FIELDS = `
  id
  shortId
  title
  severity
  type { name title }
  primaryStatus { id name title isClosed }
  secondaryStatus { name title }
  primaryVerdict { id name title }
  secondaryVerdict { id name title }
  closeReason
  managedBy
  tags
  createdAt
  updatedAt
  closedAt
  archivedAt
  detectionsCount
  eventsCount
  assetsCount
`;

/** Lista casi (offset pagination, max 100 per pagina). Default server: createdAt desc, riordinato lato Node su updatedAt. */
export const Q_CASES = /* GraphQL */ `
  query ListCases($arguments: CasesArguments!) {
    cases(arguments: $arguments) {
      totalCount
      pageInfo { hasNextPage endCursor }
      cases { ${CASE_FIELDS} }
    }
  }
`;

/**
 * Dettaglio e commenti in DUE richieste separate: con due root field insieme il backend Sophos
 * risponde a intermittenza "conn busy" / "driver: bad connection".
 */
export const Q_CASE = /* GraphQL */ `
  query GetCase($arguments: CaseArguments!) {
    case(arguments: $arguments) { ${CASE_FIELDS} keyFindings { documentType content } }
  }
`;

export const Q_CASE_COMMENTS = /* GraphQL */ `
  query GetCaseComments($arguments: CaseCommentsArguments!) {
    caseComments(arguments: $arguments) {
      totalCount
      comments { id authorId authorSubject { id } createdAt updatedAt comment isInternal }
    }
  }
`;

/* ---- Dati di riferimento (stati / verdetti): sono per-tenant, letti a runtime e messi in cache ---- */
export const Q_REFERENCE_STATUSES = /* GraphQL */ `
  query { casePrimaryStatuses(arguments: {}) { primaryStatuses { id name title isClosed } } }
`;
export const Q_REFERENCE_VERDICTS = /* GraphQL */ `
  query { casePrimaryVerdicts(arguments: {}) { primaryVerdicts { id name title } } }
`;
export const Q_REFERENCE_SECONDARY_VERDICTS = /* GraphQL */ `
  query { caseSecondaryVerdicts(arguments: {}) { secondaryVerdicts { id name title } } }
`;

/* ---- Spiegazioni AI (verificate: ~12-16 s; output SOLO in inglese, followUpPrompt non cambia la lingua) ---- */
export const Q_AI_CASE_SUMMARY = /* GraphQL */ `
  query AiCaseSummary($caseId: ID!) {
    generativeAICaseSummary(caseId: $caseId, outputFormat: MARKDOWN) { summary }
  }
`;
export const Q_AI_DETECTION = /* GraphQL */ `
  query AiDetection($detectionId: String!) {
    generativeAIDetectionAnalysis(detectionId: $detectionId, outputFormat: MARKDOWN) { analysis }
  }
`;

/* ---- Metriche (verificate) ---- */
export const Q_METRICS = /* GraphQL */ `
  query Metrics($input: CaseSummaryMetricsInput!) {
    caseSummaryMetrics(input: $input) {
      totalCases actionRequiredCases securityOperationsEffortHours
      escalatedCases unescalatedCases weekendCases weekendCasesPercentage
    }
  }
`;
/** Sintassi CQL verificata: "where <cond> | aggregate count by <campo>" (NON supporta raggruppamenti per data). */
export const Q_AGGREGATION = /* GraphQL */ `
  query Agg($query: String!) { casesAggregation(arguments: { query: $query }) { aggregation } }
`;

/**
 * Aggiornamento del caso (classificazione/chiusura). `updateCase` ha semantica PATCH (UpdateCaseInput).
 * Chiudere = primaryStatusId dello stato "closed" + primaryVerdictId (+ secondaryVerdictId, closeReason).
 */
export const M_UPDATE_CASE = /* GraphQL */ `
  mutation UpdateCase($input: UpdateCaseInput!) {
    updateCase(input: $input) {
      id
      primaryStatus { id name title isClosed }
      primaryVerdict { id name title }
      secondaryVerdict { id name title }
      closeReason
      updatedAt
    }
  }
`;

/** Aggiunge un commento (verificato dalla pagina addCaseComment). */
export const M_ADD_COMMENT = /* GraphQL */ `
  mutation AddCaseComment($input: AddCaseComment!) {
    addCaseComment(input: $input) {
      id authorId authorSubject { id } createdAt updatedAt comment caseId isInternal
    }
  }
`;

/**
 * Entità del caso, in due passi (verificati sul tenant reale):
 *  1. caseEvidence -> assetsEvidence { assetId }   (solo ID)
 *  2. assetsV2(filter: { where: { id } })          -> hostnames, users, isolationStatus
 * Nota: assetId corrisponde ad AssetV2.id (NON a hostId).
 */
export const Q_CASE_EVIDENCE = /* GraphQL */ `
  query GetCaseEvidence($arguments: CaseEvidenceArguments!) {
    caseEvidence(arguments: $arguments) {
      assetsEvidence { assetId }
      detectionsEvidence { detectionId }
      detectionsEvidenceCount
      eventsEvidenceCount
    }
  }
`;

export const Q_ASSET = /* GraphQL */ `
  query GetAsset($where: AssetWhereInputV2) {
    assetsV2(first: 1, filter: { where: $where }) {
      assets { id hostnames { hostname } users { username } isolationStatus osFamily lastSeenAt }
    }
  }
`;

/**
 * Detection del caso via alert (permesso Alert:read, disponibile anche senza Agent:read).
 * Fornisce titolo, severità (0..1), descrizione, tecniche MITRE e le entità (host, utente, IP...).
 */
export const Q_DETECTIONS = /* GraphQL */ `
  query GetDetections($ids: [String!]) {
    detectionRetrieveById(in: { iDs: $ids }) {
      alerts {
        list {
          id
          metadata { title severity }
          attack_technique_ids
          combined_username
          entities { entities }
          sensor_types
        }
      }
    }
  }
`;

export const evidenceVariables = (id: string) => ({ arguments: { id } });
export const assetVariables = (assetId: string) => ({ where: { id: assetId } });

// ---------------------------------------------------------------- variabili

export const casesVariables = (page: number) => ({
  arguments: { pagination: { offset: { page, perPage: 100 } } },
});

export const caseVariables = (id: string) => ({ arguments: { id } });

export const commentsVariables = (id: string) => ({
  arguments: { caseId: id, orderBy: 'ASCENDING', perPage: 100 },
});

// ---------------------------------------------------------------- normalizzatori

type Raw = Record<string, any>;
const norm = (v: unknown) => String(v ?? '').replace(/[^a-zA-Z]/g, '').toLowerCase();

/** Severità numerica Sophos -> livelli app. */
export function toSeverity(v: unknown): CaseSeverity {
  const n = Number(v);
  if (n >= 10) return 'critical';
  if (n >= 8) return 'high';
  if (n >= 6) return 'medium';
  return 'low';
}

/**
 * Stati primari del tenant (verificati con casePrimaryStatuses):
 * new, awaiting_sophos_assignment, in_progress, customer_action_required, on_hold, closed.
 * "awaiting_sophos_assignment" = in attesa di un analista Sophos -> per te è ancora "Nuovo", NON azione richiesta.
 */
const STATUS_BY_NAME: Record<string, CaseStatus> = {
  new: 'new',
  awaiting_sophos_assignment: 'new',
  in_progress: 'investigating',
  customer_action_required: 'actionRequired',
  on_hold: 'onHold',
  closed: 'resolved',
};
export function toStatus(c: Raw): CaseStatus {
  if (c.primaryStatus?.isClosed || c.closedAt) return 'resolved';
  const byName = STATUS_BY_NAME[String(c.primaryStatus?.name ?? '').toLowerCase()];
  if (byName) return byName;
  // stato personalizzato non previsto: euristica sul nome
  const n = norm(c.primaryStatus?.name);
  if (n.includes('customer') && n.includes('action')) return 'actionRequired';
  if (n.includes('hold')) return 'onHold';
  if (n.includes('progress')) return 'investigating';
  return 'new';
}

const toRef = (r: Raw | null | undefined) => (r?.id ? { id: String(r.id), name: String(r.name), title: String(r.title ?? r.name) } : null);

export function normalizeSummary(c: Raw): CaseSummary {
  const managed = norm(c.managedBy);
  return {
    id: String(c.id),
    shortId: c.shortId ? String(c.shortId) : undefined,
    title: String(c.title ?? 'Senza titolo'),
    severity: toSeverity(c.severity),
    status: toStatus(c),
    type: String(c.type?.title ?? c.type?.name ?? 'case'),
    managedBy: managed === 'provider' ? 'Sophos MDR' : managed === 'customer' ? 'Cliente' : String(c.managedBy ?? 'Sophos MDR'),
    primaryEntity: null, // valorizzato dopo la risoluzione degli asset (vedi sophosClient.getCases)
    verdict: toRef(c.primaryVerdict),
    secondaryVerdict: toRef(c.secondaryVerdict),
    closeReason: c.closeReason ? String(c.closeReason) : undefined,
    createdAt: String(c.createdAt ?? c.updatedAt ?? new Date().toISOString()),
    updatedAt: String(c.updatedAt ?? c.createdAt ?? new Date().toISOString()),
  };
}

/** Identifica i commenti "tuoi": authorId presente in SOPHOS_MY_AUTHOR_IDS (o uguale al client id API). */
export function normalizeComment(c: Raw, myAuthorIds: Set<string>): CaseComment {
  const authorId = String(c.authorId ?? c.authorSubject?.id ?? '');
  const mine = myAuthorIds.has(authorId);
  return {
    id: String(c.id),
    body: String(c.comment ?? ''),
    createdAt: String(c.createdAt ?? new Date().toISOString()),
    author: {
      name: mine ? 'Tu' : c.isInternal ? 'Sophos (interno)' : 'Sophos MDR',
      role: mine ? 'customer' : 'analyst',
    },
  };
}

/**
 * keyFindings.content è Markdown (documentType MARKDOWN). Per RICH_TEXT (JSON) si estraggono
 * solo i campi "text": formato non verificato, meglio un testo semplice che nulla.
 */
export function keyFindingsText(kf: Raw | null | undefined): string | undefined {
  if (!kf?.content) return undefined;
  if (norm(kf.documentType) !== 'richtext') return String(kf.content);
  try {
    const parts: string[] = [];
    const walk = (n: any) => {
      if (typeof n?.text === 'string') parts.push(n.text);
      if (Array.isArray(n?.content)) n.content.forEach(walk);
      else if (Array.isArray(n)) n.forEach(walk);
    };
    walk(JSON.parse(kf.content));
    return parts.join(' ').trim() || undefined;
  } catch {
    return String(kf.content);
  }
}

/** Severità alert Sophos (0..1) -> livelli app. */
const scoreToSeverity = (s: unknown): CaseSeverity => {
  const n = Number(s);
  return n >= 0.9 ? 'critical' : n >= 0.7 ? 'high' : n >= 0.4 ? 'medium' : 'low';
};

/** Alert -> detection + MITRE + entità (host, utenti) del caso. Nessun nome host di destinazione: solo computerName/sensorHostName. */
export function parseAlerts(alerts: Raw[]): { detections: Detection[]; mitre: MitreTechnique[]; entities: Entity[] } {
  const detections: Detection[] = [];
  const mitre = new Map<string, MitreTechnique>();
  const hosts = new Map<string, Entity>();
  const users = new Map<string, string>(); // chiave: username senza dominio, minuscolo

  for (const a of alerts) {
    detections.push({
      id: String(a.id),
      name: String(a.metadata?.title ?? a.id),
      severity: a.metadata?.severity != null ? scoreToSeverity(a.metadata.severity) : null,
      source: a.sensor_types?.[0] ? String(a.sensor_types[0]) : undefined,
    });
    for (const t of a.attack_technique_ids ?? []) if (!mitre.has(t)) mitre.set(t, { id: String(t), name: '' });

    const list: string[] = a.entities?.entities ?? [];
    const val = (prefix: string) => list.filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length));
    const names = [...val('computerName:'), ...val('sensorHostName:'), ...val('sourceHostName:')];
    for (const name of names) {
      const ip = val(`hostNameAndHostIpAddress:${name}:`).find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
      const prev = hosts.get(name.toLowerCase());
      hosts.set(name.toLowerCase(), { id: `host:${name}`, type: 'host', name, detail: prev?.detail ?? ip });
    }
    for (const u of [a.combined_username, ...val('userName:'), ...val('processUsername:')]) {
      if (!u) continue;
      const key = String(u).split('\\').pop()!.toLowerCase();
      if (!users.has(key) || (String(u).includes('\\') && !users.get(key)!.includes('\\'))) users.set(key, String(u));
    }
  }
  return {
    detections,
    mitre: [...mitre.values()],
    entities: [
      ...hosts.values(),
      ...[...users.values()].map((name) => ({ id: `user:${name}`, type: 'user' as const, name })),
    ],
  };
}

/** AssetV2 -> entità: un host (con stato isolamento) + un'entità per ogni utente. */
export function assetToEntities(a: Raw): Entity[] {
  const out: Entity[] = [];
  const host = a.hostnames?.[0]?.hostname;
  if (host) {
    out.push({
      id: String(a.id),
      type: 'host',
      name: String(host),
      detail: a.isolationStatus ? String(a.isolationStatus) : undefined,
    });
  }
  for (const u of a.users ?? []) {
    if (u?.username) out.push({ id: `${a.id}:${u.username}`, type: 'user', name: String(u.username) });
  }
  return out;
}

export function normalizeDetails(c: Raw, comments: Raw[], myAuthorIds: Set<string>, entities: Entity[] = []): CaseDetails {
  const parts = [
    `${c.detectionsCount ?? 0} detection`,
    `${c.eventsCount ?? 0} eventi`,
    `${c.assetsCount ?? 0} asset`,
  ].join(' · ');
  return {
    ...normalizeSummary(c),
    summary: `${parts}${c.tags?.length ? `\nTag: ${c.tags.join(', ')}` : ''}`,
    keyFindings: keyFindingsText(c.keyFindings),
    entities,
    detections: [],
    mitre: [],
    comments: comments
      .map((m) => normalizeComment(m, myAuthorIds))
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
  };
}
