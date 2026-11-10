/**
 * CheckCheck — the app-side checks the prompt cannot do (docs/CHECKCHECK_PLAN.md §9):
 *
 *  1. Parse the model's JSON tolerantly (grounding cannot be combined with
 *     JSON response mode) and coerce it to the v0.2 card shape — unknown enum
 *     values fall to the weakest value, missing arrays become empty.
 *  2. Every source URL must be in the RETRIEVED SET: the grounding chunks
 *     (redirects resolved to the real page), the URL-context retrievals, the
 *     records the app fetched, and the anchors the user typed. A URL on a
 *     DOMAIN that was retrieved but with a path that was not is REHOMED to
 *     the page actually retrieved from that domain (closest path wins): with
 *     Google Search grounding the model sees a page's domain and content but
 *     never its URL, so its path is a guess (probe 2026-09-28: 6 of 7
 *     citations were guessed roots or plausible paths on retrieved domains).
 *     A URL on a domain nothing was retrieved from is dropped (invented links
 *     run at 3–13 % in the literature).
 *  3. `access_level` is DERIVED by the app from where the URL came from —
 *     `api_record` for a provided record, `page_read` for a URL-context
 *     retrieval, `indexed_content` for a grounding chunk, `provided_context`
 *     for a user anchor — never taken from the model.
 *  4. `supported` is kept only when at least one of the claim's sources is
 *     `api_record`, `page_read`, or a page on an OFFICIAL REGISTER's own domain
 *     (Companies House, the FCA register, the Gazette, SEC EDGAR, the sanctions
 *     search services — `OFFICIAL_REGISTER_HOSTS`, source type assigned by rule
 *     from the resolved domain, never by the model: AGENTS_PLAN §5.3). A register
 *     page reached through search is still the register (2026-09-28: every
 *     Companies House fact read "Reported" while the API key was missing).
 *     Otherwise the claim becomes `reported`, or `self_reported` when only the
 *     subject's own pages back it.
 *  5. An item whose sources were all dropped moves to the unknowns with
 *     reason `insufficient_evidence` (the prompt's own rule); a link, image
 *     or related entity that loses its sources is removed.
 *
 * None of this verifies that a page supports a claim (that stays with the
 * reader while D?-8 is "no fetch"); it verifies that the citation is real and
 * labels how the page was reached.
 */
import type { GroundedDetailedResult } from './grounding';
import type {
  AccessLevel,
  Angle,
  CheckReport,
  CheckSubjectInput,
  ClaimStatus,
  CoverageEntry,
  CoverageState,
  Finding,
  FollowUpAction,
  ProvidedRecord,
  QuickFact,
  RelatedEntity,
  ReportLink,
  ReportQuestion,
  ReportSource,
  ReportStatus,
  SourceType,
  SubjectMatch,
  Unknown,
  ValidationStats,
} from './types';

export interface RetrievedUrl {
  url: string;
  access_level: AccessLevel;
}

/** host + path, lower-case host, no www., no trailing slash, no query, no fragment. */
/** Registers whose own pages ARE the record — a page on one of these hosts is an official record whatever the model called it. */
export const OFFICIAL_REGISTER_HOSTS: readonly string[] = [
  'find-and-update.company-information.service.gov.uk',
  'register.fca.org.uk',
  'thegazette.co.uk',
  'sec.gov',
  'efts.sec.gov',
  'search-uk-sanctions-list.service.gov.uk',
  'sanctionssearch.ofac.treas.gov',
  'register-of-charities.charitycommission.gov.uk',
  'caselaw.nationalarchives.gov.uk',
  'courtlistener.com',
];

export function isOfficialRegisterUrl(url: string | null | undefined): boolean {
  const host = hostKey(url);
  return !!host && OFFICIAL_REGISTER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function hostKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The retrieved page on the cited URL's domain whose path is closest to the cited path, or null. */
export function rehomeOnDomain(cited: string, retrieved: Map<string, RetrievedUrl>): RetrievedUrl | null {
  const host = hostKey(cited);
  const citedKey = urlKey(cited);
  if (!host || !citedKey) return null;
  let best: RetrievedUrl | null = null;
  let bestScore = -1;
  for (const [key, entry] of retrieved) {
    if (hostKey(entry.url) !== host) continue;
    if (entry.access_level === 'provided_context' || entry.access_level === 'api_record') continue;
    let score = 0;
    const max = Math.min(key.length, citedKey.length);
    while (score < max && key[score] === citedKey[score]) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

export function urlKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try the next shape
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strOr = (v: unknown, fallback: string): string => str(v) ?? fallback;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const arr = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const CLAIM: readonly ClaimStatus[] = ['supported', 'self_reported', 'reported', 'inference', 'conflicted'];
const COVERAGE: readonly CoverageState[] = ['checked', 'not_searched', 'searched_no_match', 'source_unavailable', 'conflicting_sources', 'needs_confirmation'];
const SOURCE_TYPE: readonly SourceType[] = ['official_record', 'first_party', 'independent_reporting', 'review_platform', 'user_provided'];
const MATCH: readonly SubjectMatch[] = ['matched', 'ambiguous', 'different'];
const ANGLE: readonly Angle[] = ['investor_meeting', 'client_work', 'new_connection', 'supplier_work', 'general'];
const STATUS: readonly ReportStatus[] = ['complete', 'partial', 'needs_clarification'];
const ACTION: readonly FollowUpAction['action'][] = ['answer_from_evidence', 'research_more', 'compare_sources', 'refresh_topic', 'research_related_entity'];

/** Build the retrieved set: what Google actually retrieved/read, the app's records, the user's anchors. */
export function buildRetrievedSet(
  grounding: Pick<GroundedDetailedResult, 'chunks' | 'urlContext'>,
  resolvedChunkUrls: Map<number, string>,
  records: ProvidedRecord[],
  subject: CheckSubjectInput,
): Map<string, RetrievedUrl> {
  const set = new Map<string, RetrievedUrl>();
  const add = (url: string | null | undefined, level: AccessLevel) => {
    const key = urlKey(url);
    if (!key || !url) return;
    const existing = set.get(key);
    // Stronger levels win when the same page was reached two ways.
    const rank: Record<AccessLevel, number> = { api_record: 4, page_read: 3, indexed_content: 2, provided_context: 1, search_only: 0 };
    if (!existing || rank[level] > rank[existing.access_level]) set.set(key, { url, access_level: level });
  };
  for (const record of records) add(record.url, 'api_record');
  for (const entry of grounding.urlContext) {
    if (!entry.status || /success/i.test(entry.status)) add(entry.url, 'page_read');
  }
  for (const chunk of grounding.chunks) add(resolvedChunkUrls.get(chunk.index) ?? chunk.uri, 'indexed_content');
  add(subject.website, 'provided_context');
  add(subject.profile_url, 'provided_context');
  return set;
}

export interface ValidatedReport {
  report: CheckReport;
  stats: ValidationStats;
}

export function coerceAndValidate(
  raw: Record<string, unknown>,
  retrieved: Map<string, RetrievedUrl>,
  records: ProvidedRecord[],
): ValidatedReport {
  const dropped: ValidationStats['dropped'] = [];
  const rehomed: ValidationStats['rehomed'] = [];
  const recordIds = new Set(records.map((record) => record.id));
  const recordByUrl = new Map(records.map((record) => [urlKey(record.url), record] as const));

  // --- sources -------------------------------------------------------------
  const sourcesIn = arr(raw.sources);
  const sources: ReportSource[] = [];
  for (const source of sourcesIn) {
    const id = str(source.id);
    if (!id) continue;
    const url = str(source.url);
    const sourceType = oneOf(source.source_type, SOURCE_TYPE, 'independent_reporting');
    let accessLevel: AccessLevel;
    let keptUrl: string | null = url;
    if (!url) {
      // A source without a URL is only legitimate for user-provided context.
      if (sourceType !== 'user_provided') {
        dropped.push({ id, url: null, reason: 'no_url' });
        continue;
      }
      accessLevel = 'provided_context';
    } else {
      const key = urlKey(url);
      let hit = key ? retrieved.get(key) : undefined;
      if (!hit) {
        const onDomain = rehomeOnDomain(url, retrieved);
        if (!onDomain) {
          dropped.push({ id, url, reason: 'not_retrieved' });
          continue;
        }
        rehomed.push({ id, cited: url, replaced_by: onDomain.url });
        hit = onDomain;
      }
      accessLevel = hit.access_level;
      keptUrl = hit.url;
    }
    const record = keptUrl ? recordByUrl.get(urlKey(keptUrl)) : undefined;
    sources.push({
      id,
      title: str(source.title) ?? record?.title ?? null,
      url: keptUrl,
      source_type: record || isOfficialRegisterUrl(keptUrl) ? 'official_record' : sourceType,
      access_level: accessLevel,
      published_at: str(source.published_at),
      retrieved_at: str(source.retrieved_at) ?? record?.retrieved_at ?? null,
      entity_ids: ids(source.entity_ids),
      subject_match: oneOf(source.subject_match, MATCH, 'ambiguous'),
      identity_basis: str(source.identity_basis),
    });
  }
  // The model may cite a provided record by its id without listing it under sources.
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const record of records) {
    if (!sourceIds.has(record.id)) {
      sources.push({
        id: record.id,
        title: record.title,
        url: record.url,
        source_type: 'official_record',
        access_level: 'api_record',
        published_at: null,
        retrieved_at: record.retrieved_at,
        entity_ids: [],
        subject_match: 'ambiguous',
        identity_basis: null,
      });
      sourceIds.add(record.id);
    }
  }
  // `supported` needs a record or a page read that is NOT the subject's own site:
  // a first-party page proves they said it, not that it is true (AGENTS_PLAN §5.3).
  const strongSources = new Set(
    sources
      .filter((s) => ((s.access_level === 'api_record' || s.access_level === 'page_read') && s.source_type !== 'first_party') || isOfficialRegisterUrl(s.url))
      .map((s) => s.id),
  );
  const firstPartySources = new Set(sources.filter((s) => s.source_type === 'first_party' || s.access_level === 'provided_context').map((s) => s.id));
  const keepSourceIds = (list: unknown): string[] => ids(list).filter((id) => sourceIds.has(id) || recordIds.has(id));

  let downgraded = 0;
  const claimStatus = (v: unknown, sourceIdsKept: string[]): ClaimStatus => {
    const status = oneOf(v, CLAIM, 'reported');
    if (status === 'supported' && !sourceIdsKept.some((id) => strongSources.has(id))) {
      downgraded += 1;
      return sourceIdsKept.length > 0 && sourceIdsKept.every((id) => firstPartySources.has(id)) ? 'self_reported' : 'reported';
    }
    return status;
  };

  // --- items ---------------------------------------------------------------
  const unknowns: Unknown[] = arr(raw.unknowns).flatMap((u) => {
    const id = str(u.id);
    if (!id) return [];
    return [{
      id,
      question: strOr(u.question, 'Unstated'),
      reason: oneOf(u.reason, [...COVERAGE, 'insufficient_evidence'] as const, 'insufficient_evidence'),
      importance: strOr(u.importance, ''),
      next_step: strOr(u.next_step, ''),
      related_item_ids: ids(u.related_item_ids),
      source_ids: keepSourceIds(u.source_ids),
    }];
  });
  let moved = 0;
  const moveToUnknowns = (id: string, label: string) => {
    moved += 1;
    unknowns.push({
      id: `${id}-unsupported`,
      question: label,
      reason: 'insufficient_evidence',
      importance: 'The report stated this but none of its cited sources was among the pages actually retrieved.',
      next_step: 'Ask the counterparty or find a source you can open.',
      related_item_ids: [id],
      source_ids: [],
    });
  };

  const quickFacts: QuickFact[] = [];
  for (const fact of arr(raw.quick_facts)) {
    const id = str(fact.id);
    const text = str(fact.text);
    if (!id || !text) continue;
    const kept = keepSourceIds(fact.source_ids);
    const status = claimStatus(fact.claim_status, kept);
    if (kept.length === 0 && status !== 'inference') {
      moveToUnknowns(id, `${strOr(fact.label, 'Fact')}: ${text}`);
      continue;
    }
    quickFacts.push({ id, label: strOr(fact.label, 'Fact'), text, claim_status: status, as_of: str(fact.as_of), source_ids: kept });
  }

  const findings: Finding[] = [];
  for (const finding of arr(raw.findings)) {
    const id = str(finding.id);
    const text = str(finding.text);
    if (!id || !text) continue;
    const kept = keepSourceIds(finding.source_ids);
    const status = claimStatus(finding.claim_status, kept);
    if (kept.length === 0 && status !== 'inference') {
      moveToUnknowns(id, strOr(finding.title, text));
      continue;
    }
    findings.push({
      id,
      title: strOr(finding.title, text.slice(0, 80)),
      text,
      relevance: strOr(finding.relevance, ''),
      claim_status: status,
      as_of: str(finding.as_of),
      entity_ids: ids(finding.entity_ids),
      source_ids: kept,
    });
  }

  const subjectIn = (raw.subject ?? {}) as Record<string, unknown>;
  const links: ReportLink[] = arr(subjectIn.links).flatMap((link) => {
    const url = str(link.url);
    const kept = keepSourceIds(link.source_ids);
    const key = urlKey(url);
    // A link needs a real URL that was retrieved, or a kept source vouching for it.
    if (!url || !key || (!retrieved.has(key) && kept.length === 0)) return [];
    return [{ label: strOr(link.label, url), platform: str(link.platform), url, source_ids: kept }];
  });
  const imageIn = subjectIn.image && typeof subjectIn.image === 'object' ? (subjectIn.image as Record<string, unknown>) : null;
  const imageUrl = imageIn ? str(imageIn.url) : null;
  const imagePage = imageIn ? str(imageIn.source_page_url) : null;
  const imagePageKey = urlKey(imagePage);
  const image = imageUrl && /^https:\/\//i.test(imageUrl) && imagePageKey && retrieved.has(imagePageKey)
    ? { url: imageUrl, kind: oneOf(imageIn?.kind, ['portrait', 'logo'] as const, 'logo'), alt_text: str(imageIn?.alt_text), source_id: str(imageIn?.source_id), source_page_url: imagePage }
    : null;
  const related: RelatedEntity[] = arr(subjectIn.related_entities).flatMap((entity) => {
    const id = str(entity.id);
    const name = str(entity.name);
    const kept = keepSourceIds(entity.source_ids);
    if (!id || !name || kept.length === 0) return [];
    return [{
      id,
      type: strOr(entity.type, 'company'),
      name,
      website: str(entity.website),
      relationship: strOr(entity.relationship, ''),
      relationship_status: oneOf(entity.relationship_status, ['current', 'former', 'unknown'] as const, 'unknown'),
      valid_from: str(entity.valid_from),
      valid_to: str(entity.valid_to),
      source_ids: kept,
    }];
  });

  const questions: ReportQuestion[] = arr(raw.questions).flatMap((q) => {
    const id = str(q.id);
    const text = str(q.text);
    return id && text ? [{ id, text, based_on_item_ids: ids(q.based_on_item_ids) }] : [];
  });
  const actions: FollowUpAction[] = arr(raw.follow_up_actions).flatMap((a) => {
    const id = str(a.id);
    const label = str(a.label);
    return id && label
      ? [{ id, label, action: oneOf(a.action, ACTION, 'research_more'), target_item_ids: ids(a.target_item_ids), suggested_request: strOr(a.suggested_request, label) }]
      : [];
  });
  const coverage: CoverageEntry[] = arr(raw.coverage).flatMap((c) => {
    const topic = str(c.topic);
    return topic ? [{ topic, state: oneOf(c.state, COVERAGE, 'not_searched'), detail: strOr(c.detail, ''), source_ids: keepSourceIds(c.source_ids) }] : [];
  });
  const clarificationIn = raw.clarification && typeof raw.clarification === 'object' ? (raw.clarification as Record<string, unknown>) : null;
  const clarification = clarificationIn && str(clarificationIn.question)
    ? {
        question: String(clarificationIn.question).trim(),
        candidates: arr(clarificationIn.candidates).flatMap((cand) => {
          const name = str(cand.name);
          return name ? [{ name, details: strOr(cand.details, ''), source_ids: keepSourceIds(cand.source_ids) }] : [];
        }),
      }
    : null;
  const intentIn = (raw.intent ?? {}) as Record<string, unknown>;
  const summaryIn = (raw.summary ?? {}) as Record<string, unknown>;
  let status = oneOf(raw.status, STATUS, 'partial');
  if (clarification && status !== 'needs_clarification') status = 'needs_clarification';
  if (!clarification && status === 'needs_clarification') status = 'partial';

  const report: CheckReport = {
    schema_version: strOr(raw.schema_version, '0.2'),
    status,
    intent: {
      primary_angle: oneOf(intentIn.primary_angle, ANGLE, 'general'),
      secondary_angles: ids(intentIn.secondary_angles).filter((a): a is Angle => (ANGLE as readonly string[]).includes(a)),
      goal: strOr(intentIn.goal, ''),
    },
    subject: {
      id: strOr(subjectIn.id, 'subject'),
      type: oneOf(subjectIn.type, ['person', 'company'] as const, 'company'),
      display_name: strOr(subjectIn.display_name, ''),
      headline: str(subjectIn.headline),
      location: str(subjectIn.location),
      fact_ids: ids(subjectIn.fact_ids).filter((id) => quickFacts.some((fact) => fact.id === id)),
      image,
      links,
      related_entities: related,
    },
    quick_facts: quickFacts,
    summary: { text: strOr(summaryIn.text, ''), supporting_item_ids: ids(summaryIn.supporting_item_ids) },
    findings,
    unknowns,
    questions,
    follow_up_actions: actions,
    coverage,
    sources,
    clarification,
    continuation: null,
  };

  return {
    report,
    stats: {
      sources_total: sourcesIn.length,
      sources_kept: sources.length,
      sources_dropped: dropped.length,
      items_moved_to_unknowns: moved,
      claims_downgraded: downgraded,
      retrieved_urls: retrieved.size,
      sources_rehomed: rehomed.length,
      dropped,
      rehomed,
    },
  };
}
