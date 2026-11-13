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
import type { CaseComment, CaseDetails, CaseSeverity, CaseStatus, CaseSummary, Entity } from '../types';

// ---------------------------------------------------------------- GraphQL documents

const CASE_FIELDS = `
  id
  shortId
  title
  severity
  type { name title }
  primaryStatus { name title isClosed }
  secondaryStatus { name title }
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
 * Gli stati sono definiti per-tenant (casePrimaryStatuses / caseSecondaryStatuses).
 * Mappatura euristica sui nomi; adatta qui se i tuoi nomi differiscono.
 */
export function toStatus(c: Raw): CaseStatus {
  if (c.primaryStatus?.isClosed || c.closedAt) return 'resolved';
  const names = norm(`${c.primaryStatus?.name} ${c.secondaryStatus?.name}`);
  if (names.includes('action') || names.includes('awaiting')) return 'actionRequired';
  if (names.includes('hold')) return 'onHold';
  if (names.includes('investigat') || names.includes('progress') || names.includes('triage')) return 'investigating';
  return 'new';
}

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
    primaryEntity: null, // l'host principale non è sul tipo Case (vedi Q_CASE_EVIDENCE_TODO)
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
