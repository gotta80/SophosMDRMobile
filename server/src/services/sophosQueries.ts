import { currentLang } from '../lang';
import { decode, htmlToMarkdown } from './htmlText';
/**
 * GraphQL queries / mutations for Sophos Cases GraphQL (cases-v2 schema) + normalizers.
 * Source: https://developer.sophos.com/graphql/cases-v2/  (schema: /assets/graphql/cases-v2.graphql)
 * Endpoint: POST https://api.taegis.sophos.com/graphql  (Authorization + X-Tenant-ID headers)
 *
 * Verified from the SDL document: root fields cases/case/caseComments, mutation addCaseComment,
 * fields of `Case` (severity is Int!: 2 Info, 4 Low, 6 Medium, 8 High, 10 Critical).
 *
 * NOT verified (to check with a real call):
 *  - CQL filter syntax (NOT used here: we filter/sort on the Node server side);
 *  - primaryStatus/secondaryStatus names (they are per-tenant: the mapping is in toStatus());
 *  - `CaseArguments { id }` for the `case` query;
 *  - response of `caseComments` (`comments` field);
 *  - how to identify an MDR analyst: the schema has no flag -> see SOPHOS_MY_AUTHOR_IDS.
 * The schema does NOT expose MITRE, hosts/users or detections as lists on the Case type (counts only;
 * the lists live in `caseEvidence`, whose sub-fields are not mapped here yet: see Q_CASE_EVIDENCE_TODO).
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

/** Case list (offset pagination, max 100 per page). Server default: createdAt desc, re-sorted on the Node side by updatedAt. */
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
 * Detail and comments in TWO separate requests: with two root fields together the Sophos backend
 * intermittently answers "conn busy" / "driver: bad connection".
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

/* ---- Reference data (statuses / verdicts): per-tenant, read at runtime and cached ---- */
export const Q_REFERENCE_STATUSES = /* GraphQL */ `
  query { casePrimaryStatuses(arguments: {}) { primaryStatuses { id name title isClosed } } }
`;
export const Q_REFERENCE_VERDICTS = /* GraphQL */ `
  query { casePrimaryVerdicts(arguments: {}) { primaryVerdicts { id name title } } }
`;
export const Q_REFERENCE_SECONDARY_VERDICTS = /* GraphQL */ `
  query { caseSecondaryVerdicts(arguments: {}) { secondaryVerdicts { id name title } } }
`;

/* ---- AI explanations (verified: ~12-16 s; output ONLY in English, followUpPrompt does not change the language) ---- */
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

/* ---- Metrics (verified) ---- */
export const Q_METRICS = /* GraphQL */ `
  query Metrics($input: CaseSummaryMetricsInput!) {
    caseSummaryMetrics(input: $input) {
      totalCases actionRequiredCases securityOperationsEffortHours
      escalatedCases unescalatedCases weekendCases weekendCasesPercentage
    }
  }
`;
/** Verified CQL syntax: "where <cond> | aggregate count by <field>" (does NOT support grouping by date). */
export const Q_AGGREGATION = /* GraphQL */ `
  query Agg($query: String!) { casesAggregation(arguments: { query: $query }) { aggregation } }
`;

/**
 * Case update (classification/closing). `updateCase` has PATCH semantics (UpdateCaseInput).
 * Closing = primaryStatusId of the "closed" status + primaryVerdictId (+ secondaryVerdictId, closeReason).
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

/** Adds a comment (verified from the addCaseComment page). */
export const M_ADD_COMMENT = /* GraphQL */ `
  mutation AddCaseComment($input: AddCaseComment!) {
    addCaseComment(input: $input) {
      id authorId authorSubject { id } createdAt updatedAt comment caseId isInternal
    }
  }
`;

/**
 * Case entities, in two steps (verified on a real tenant):
 *  1. caseEvidence -> assetsEvidence { assetId }   (IDs only)
 *  2. assetsV2(filter: { where: { id } })          -> hostnames, users, isolationStatus
 * Note: assetId matches AssetV2.id (NOT hostId).
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
 * Case detections via alerts (Alert:read permission, available even without Agent:read).
 * Provides title, severity (0..1), description, MITRE techniques and entities (host, user, IP...).
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

// ---------------------------------------------------------------- variables

export const casesVariables = (page: number) => ({
  arguments: { pagination: { offset: { page, perPage: 100 } } },
});

export const caseVariables = (id: string) => ({ arguments: { id } });

export const commentsVariables = (id: string) => ({
  arguments: { caseId: id, orderBy: 'ASCENDING', perPage: 100 },
});

// ---------------------------------------------------------------- normalizers

type Raw = Record<string, any>;
const norm = (v: unknown) => String(v ?? '').replace(/[^a-zA-Z]/g, '').toLowerCase();

/** Sophos numeric severity -> app levels. */
export function toSeverity(v: unknown): CaseSeverity {
  const n = Number(v);
  if (n >= 10) return 'critical';
  if (n >= 8) return 'high';
  if (n >= 6) return 'medium';
  return 'low';
}

/**
 * Primary statuses of the tenant (verified with casePrimaryStatuses):
 * new, awaiting_sophos_assignment, in_progress, customer_action_required, on_hold, closed.
 * "awaiting_sophos_assignment" = waiting for a Sophos analyst -> for you it is still "New", NOT action required.
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
  // unexpected custom status: heuristic on the name
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
    title: decode(String(c.title ?? 'Senza titolo')),
    severity: toSeverity(c.severity),
    status: toStatus(c),
    type: String(c.type?.title ?? c.type?.name ?? 'case'),
    managedBy: managed === 'provider' ? 'Sophos MDR' : managed === 'customer' ? 'Cliente' : String(c.managedBy ?? 'Sophos MDR'),
    primaryEntity: null, // set after resolving the assets (vedi sophosClient.getCases)
    verdict: toRef(c.primaryVerdict),
    secondaryVerdict: toRef(c.secondaryVerdict),
    closeReason: c.closeReason ? String(c.closeReason) : undefined,
    createdAt: String(c.createdAt ?? c.updatedAt ?? new Date().toISOString()),
    updatedAt: String(c.updatedAt ?? c.createdAt ?? new Date().toISOString()),
  };
}

/** Automated author used by Sophos for its notification comments ("... email sent to authorized contacts"). */
const SYSTEM_AUTHOR = 'mtr-to-central';

/**
 * Who wrote a comment. The API only gives an opaque authorId (the author's name cannot be resolved with an API
 * credential), so the side is inferred:
 *   - "yours": authorId in SOPHOS_MY_AUTHOR_IDS (or equal to the API client id)      -> role 'customer'
 *   - Sophos automation (mtr-to-central)                                               -> role 'system'
 *   - a colleague (customer side): the author is in `colleagues` (learned by learnAuthors)  -> role 'colleague'
 *   - everybody else is the Sophos SOC                                                  -> role 'analyst'
 */
export function normalizeComment(c: Raw, myAuthorIds: Set<string>, colleagues: Set<string> = new Set()): CaseComment {
  const authorId = String(c.authorId ?? c.authorSubject?.id ?? '');
  const en = currentLang() === 'en';
  const base = { id: String(c.id), body: String(c.comment ?? ''), createdAt: String(c.createdAt ?? new Date().toISOString()) };
  if (myAuthorIds.has(authorId)) return { ...base, author: { name: 'Tu', role: 'customer' } };
  if (authorId === SYSTEM_AUTHOR) return { ...base, author: { name: 'Sophos MDR', role: 'system' } };
  if (colleagues.has(authorId)) return { ...base, author: { name: en ? 'Colleague' : 'Collega', role: 'colleague' } };
  return { ...base, author: { name: c.isInternal ? (en ? 'Sophos (internal)' : 'Sophos (interno)') : 'Sophos MDR', role: 'analyst' } };
}

const MENTIONS_SOPHOS = /(^|[\s(])@sophos\b/i; // customers address the MDR team with @sophos
const MENTIONS_CUSTOMER = /(^|[\s(])@authorized_contacts\b/i; // the SOC addresses the customer's authorized contacts

/**
 * Learns who is a colleague: an author who writes "@sophos" is on the customer side, one who writes
 * "@authorized_contacts" is the SOC. `colleagues` is updated in place and keeps what was learned in other cases.
 */
export function learnAuthors(comments: Raw[], myAuthorIds: Set<string>, colleagues: Set<string>, soc: Set<string>): void {
  for (const c of comments) {
    const id = String(c.authorId ?? c.authorSubject?.id ?? '');
    if (!id || id === SYSTEM_AUTHOR || myAuthorIds.has(id)) continue;
    const body = String(c.comment ?? '');
    if (MENTIONS_CUSTOMER.test(body)) soc.add(id);
    else if (MENTIONS_SOPHOS.test(body)) colleagues.add(id);
  }
  for (const id of soc) colleagues.delete(id); // an author seen on both sides is the SOC
}

/**
 * keyFindings.content is Markdown (documentType MARKDOWN). For RICH_TEXT (JSON) we extract
 * only the "text" fields: format not verified, better plain text than nothing.
 */
export function keyFindingsText(kf: Raw | null | undefined): string | undefined {
  if (!kf?.content) return undefined;
  if (norm(kf.documentType) !== 'richtext') return htmlToMarkdown(String(kf.content));
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

/** Sophos alert severity (0..1) -> app levels. */
const scoreToSeverity = (s: unknown): CaseSeverity => {
  const n = Number(s);
  return n >= 0.9 ? 'critical' : n >= 0.7 ? 'high' : n >= 0.4 ? 'medium' : 'low';
};

/** Alert -> detection + MITRE + entities (hosts, users) of the case. No destination host name: only computerName/sensorHostName. */
export function parseAlerts(alerts: Raw[]): { detections: Detection[]; mitre: MitreTechnique[]; entities: Entity[] } {
  const detections: Detection[] = [];
  const mitre = new Map<string, MitreTechnique>();
  const hosts = new Map<string, Entity>();
  const users = new Map<string, string>(); // key: username without domain, lowercase

  for (const a of alerts) {
    detections.push({
      id: String(a.id),
      name: decode(String(a.metadata?.title ?? a.id)),
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

/** AssetV2 -> entities: one host (with isolation status) + one entity per user. */
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

export function normalizeDetails(c: Raw, comments: Raw[], myAuthorIds: Set<string>, entities: Entity[] = [], colleagues: Set<string> = new Set()): CaseDetails {
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
      .map((m) => normalizeComment(m, myAuthorIds, colleagues))
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
  };
}
