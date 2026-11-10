/**
 * One check, end to end, with no database:
 *
 *   records the app fetches itself → ONE searched Muse Ember call → validation → the finished run.
 *
 * This is CheckCheck's briefing pipeline from Jinna (its `executeBriefing`), minus everything that
 * needed a Jinna account (owner context, contacts, previous checks, activity feed) and with the
 * evidence taken from OpenRouter's citation annotations instead of Gemini's grounding metadata.
 *
 * What changes with that evidence, and how it is reported (never silently):
 *   - There is no sentence-to-source mapping, so the namesake guard cannot run. It is listed under
 *     `checks_not_run`, and the page count that names the subject is reported instead.
 *   - The search queries are not returned, so they cannot be inspected. Listed under `checks_not_run`.
 *   - Excerpts are fragments of a page. They are used as positive evidence only (a source chip can
 *     be placed where an excerpt supports a sentence); a figure is dropped only when the app read
 *     the cited page itself and the figure is not on it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectRecords } from './records';
import { buildHeader } from './header';
import { chat, toGrounding, OpenRouterError, MODEL, type CallUsage, type ChatResult } from './openrouter';
import { buildDemoPrompt, DEMO_PROMPT_VERSION, DEMO_SYSTEM_PROMPT, PRIVATE_SECTION_TITLE } from './prompt';
import { clarificationOf } from './details';
import { extractEntitiesTrailer, type BriefingEntities } from './entitiesTrailer';
import { buildRetrievedSet, urlKey } from './validateReport';
import { formatSourcesChecked, pageNamesSubject, redirectMap, validateBriefingText } from './validateBriefing';
import { gatherLinkEvidence, subjectTokens } from './linkEvidence';
import { pageCandidates, readPages, type CachedPage } from './pageCache';
import { stripOriginClaims, verifyFigures, verifyLocation } from './pageVerification';
import { ensureRegistryLines, registryLines } from './registryLines';
import { dropAbsenceClaims, dropEmptySections, dropRoutineDomainLines, dropTechStack, dropUnsourcedHandles, dropUntrustedRatings, isUntrustedReviewPage } from './routineFilters';
import { companyTokens, profileCompanies } from './profileCompanies';
import type { CheckHeader, CheckSubjectInput, ProvidedRecord } from './types';

export type RunStatus = 'complete' | 'partial' | 'needs_clarification' | 'failed';

export interface CostLine {
  step: 'extraction' | 'research';
  cost_usd: number | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  searches: number | null;
  ms: number;
}

export interface CheckNotRun {
  check: string;
  why: string;
}

export interface FinishedRun {
  id: string;
  status: RunStatus;
  stop_reason: string | null;
  refusal: null;
  subject: CheckSubjectInput;
  user_request: string | null;
  angle: null;
  contact_id: null;
  report: null;
  briefing_text: string | null;
  header: CheckHeader | null;
  owner_edits: null;
  records: ProvidedRecord[];
  validation: Record<string, unknown> | null;
  models: Record<string, unknown>;
  created_at: string;
  completed_at: string;
  expires_at: null;
  /** Standalone additions. */
  cost: { total_usd: number | null; complete: boolean; lines: CostLine[] };
  evidence: {
    pages_cited: number;
    pages_with_excerpts: number;
    pages_read_by_app: number;
    pages_naming_subject: number;
    figures_checked: number;
    figures_removed: number;
    links_checked: number;
    links_removed: number;
    identity: 'anchored' | 'name_only' | 'unconfirmed';
    identity_note: string | null;
    checks_not_run: CheckNotRun[];
  } | null;
  /** Failure text for the visitor (status `failed`). */
  message?: string;
}

export interface RunLimits {
  maxSearches: number;
  maxOutputTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high';
  timeoutMs: number;
}

export type Stage = 'records' | 'research' | 'validating';

const FREE_MAIL = /(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|mail|yandex)\./;

export const newRunId = (): string => randomBytes(16).toString('hex');

/** The run keeps a hash of an e-mail address (Gravatar's key), never the address; a business domain becomes the website anchor. */
export function prepareSubject(subject: CheckSubjectInput): CheckSubjectInput {
  const { email, ...rest } = subject;
  const out: CheckSubjectInput = { ...rest };
  if (email) {
    const address = email.trim().toLowerCase();
    out.email_hash = createHash('sha256').update(address).digest('hex');
    const domain = address.split('@')[1];
    if (!out.website && domain && !FREE_MAIL.test(`${domain}.`)) out.website = `https://${domain}`;
  }
  return out;
}

const costLine = (step: CostLine['step'], usage: CallUsage): CostLine => ({
  step,
  cost_usd: usage.costUsd,
  prompt_tokens: usage.promptTokens,
  output_tokens: usage.outputTokens,
  reasoning_tokens: usage.reasoningTokens,
  searches: usage.searches,
  ms: usage.ms,
});

export function totalCost(lines: CostLine[]): { total_usd: number | null; complete: boolean } {
  const known = lines.filter((l) => l.cost_usd !== null);
  if (known.length === 0) return { total_usd: null, complete: false };
  return { total_usd: Math.round(known.reduce((sum, l) => sum + (l.cost_usd as number), 0) * 1e6) / 1e6, complete: known.length === lines.length };
}

/**
 * Progress chatter before the first heading ("Searching for…") is not part of the report. The model
 * sometimes glues it to the heading on one line ("…recent developments.## Profile"), so headings are
 * first put on their own lines; everything before the first one is dropped.
 */
export function stripPreamble(text: string): string {
  const separated = text.replace(/([^\n#])[ \t]*(#{2,4}[ \t]+\S)/g, '$1\n\n$2');
  const at = separated.search(/^#{1,4}\s+\S/m);
  return at > 0 ? separated.slice(at) : separated;
}

/**
 * The model cites a source as a Markdown link after the sentence. The report view shows sources as
 * chips under each section (`[Name](url "source")`), so a citation link — one that closes a sentence
 * or a clause and points at a page the search returned — is rewritten into that form. Links inside a
 * sentence (a company's name linked to its site), the Profile lines and the Sources list are left alone.
 * A citation labelled with the subject's own name is renamed to its site ("octopus.energy"), otherwise
 * every chip of a company report would carry the same name.
 */
export function citationsToChips(text: string, retrieved: ReadonlyMap<string, { url: string }>, subjectName: string): string {
  const known = new Set([...retrieved.values()].map((r) => urlKey(r.url)).filter(Boolean));
  const subject = subjectName.trim().toLowerCase();
  let inProfile = false;
  let inSources = false;
  return text
    .split('\n')
    .map((line) => {
      const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line.trim());
      if (heading) {
        inProfile = /^profile$/i.test(heading[1]);
        return line;
      }
      if (/^\*\*Sources checked/i.test(line.trim())) inSources = true;
      if (inProfile || inSources) return line;
      return line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)(?=\s*(?:[.;,:)]|$|\[))/g, (whole, label: string, url: string, offset: number, all: string) => {
        if (!known.has(urlKey(url))) return whole;
        // "Registered at: [Companies House](…)" — the link is the value of a label, not a citation.
        if (/:\s*$/.test(all.slice(0, offset))) return whole;
        // A citation follows prose; a link that opens the line is part of the sentence.
        if (!all.slice(0, offset).trim()) return whole;
        const host = hostOfUrl(url);
        const clean = label.replace(/\*\*|__|\*/g, '').replace(/\s+/g, ' ').trim();
        const name = !clean || clean.toLowerCase() === subject || /^https?:/i.test(clean) || clean.length > 32 ? host : clean;
        return `[${name}](${url} "source")`;
      });
    })
    .join('\n');
}

function hostOfUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const FAILURE_COPY: Record<string, string> = {
  timeout: 'The research took too long and was stopped. Nothing was saved. Try again, or add a website or company so there is less to search.',
  context_too_long: 'There was too much material about this subject to fit in one request. Try again with a shorter request.',
  credits: 'This demo has run out of research credit for now. Please come back later.',
  wrong_model: 'The research was answered by an unexpected model and was discarded. Please try again.',
  no_key: 'The server is not configured with a model key.',
  empty_briefing: 'The research finished without writing a report. This usually means it ran out of room while thinking. Please try again.',
  research_failed: 'The research could not be completed. Please try again.',
};

export async function runCheck(input: {
  runId: string;
  subject: CheckSubjectInput;
  userRequest: string;
  limits: RunLimits;
  priorCost: CostLine[];
  onStage?: (stage: Stage) => void;
  /** Development only: a saved model answer to run the validation on again, with no model call and no cost. */
  replay?: ChatResult;
}): Promise<FinishedRun> {
  const startedAt = Date.now();
  const createdAt = new Date().toISOString();
  const subject = input.subject;
  const lines: CostLine[] = [...input.priorCost];
  const base = {
    id: input.runId,
    refusal: null,
    subject,
    user_request: input.userRequest,
    angle: null,
    contact_id: null,
    report: null,
    owner_edits: null,
    created_at: createdAt,
    expires_at: null,
  } as const;
  const models = (extra: Record<string, unknown> = {}) => ({
    output_mode: 'briefing',
    research: MODEL,
    search: `openrouter:web_search / exa / max ${input.limits.maxSearches}`,
    reasoning: input.limits.reasoningEffort,
    prompt_version: DEMO_PROMPT_VERSION,
    ...extra,
  });
  const fail = (reason: string, records: ProvidedRecord[] = [], header: CheckHeader | null = null): FinishedRun => ({
    ...base,
    status: 'failed',
    stop_reason: reason,
    briefing_text: null,
    header,
    records,
    validation: null,
    models: models(),
    completed_at: new Date().toISOString(),
    cost: { ...totalCost(lines), lines },
    evidence: null,
    message: FAILURE_COPY[reason] ?? FAILURE_COPY.research_failed,
  });

  input.onStage?.('records');
  const { records, coverage } = await collectRecords(subject);
  const headerPromise: Promise<CheckHeader | null> = buildHeader(subject, records)
    // Month and year of birth come with register officer data; this briefing never shows them.
    .then((h) => ({ ...h, born: null }))
    .catch(() => null);

  input.onStage?.('research');
  let grounding;
  try {
    const result = input.replay ?? await chat({
      system: DEMO_SYSTEM_PROMPT,
      user: buildDemoPrompt({ subject, userRequest: input.userRequest, records, recordCoverage: coverage, maxSearches: input.limits.maxSearches }),
      maxOutputTokens: input.limits.maxOutputTokens,
      temperature: 0.2,
      reasoningEffort: input.limits.reasoningEffort,
      timeoutMs: input.limits.timeoutMs,
      search: { maxSearches: input.limits.maxSearches, maxResults: 5 },
    });
    lines.push(costLine('research', result.usage));
    grounding = toGrounding(result);
    // Development only (CHECKCHECK_DEBUG_DIR): keep the raw answer so validation changes can be replayed without paying again.
    const debugDir = (process.env.CHECKCHECK_DEBUG_DIR ?? '').trim();
    if (debugDir && !input.replay) {
      await mkdir(debugDir, { recursive: true }).catch(() => undefined);
      await writeFile(path.join(debugDir, `answer-${input.runId}.json`), JSON.stringify({ subject, userRequest: input.userRequest, result }, null, 1)).catch(() => undefined);
    }
  } catch (err: unknown) {
    const kind = err instanceof OpenRouterError ? err.kind : 'research_failed';
    console.error(`[checkcheck] run=${input.runId} research failed kind=${kind} ${err instanceof Error ? err.message.slice(0, 200) : ''}`);
    return fail(kind === 'http' || kind === 'bad_response' ? 'research_failed' : kind, records, await headerPromise);
  }
  const header = await headerPromise;

  input.onStage?.('validating');
  const cutShort = grounding.finishReason !== null && grounding.finishReason !== 'STOP';
  const rawText = grounding.text.trim();
  if (!rawText) return fail('empty_briefing', records, header);

  const { text: trailerFree, entities } = extractEntitiesTrailer(rawText);
  // The research could not tell which subject was meant and answered with a question: that is not a report.
  const clarification = clarificationOf(trailerFree);
  if (clarification) {
    return {
      ...base,
      status: 'needs_clarification',
      stop_reason: 'needs_details',
      briefing_text: clarification,
      header,
      records,
      validation: null,
      models: models({ finish_reason: grounding.finishReason }),
      completed_at: new Date().toISOString(),
      cost: { ...totalCost(lines), lines },
      evidence: null,
    };
  }
  const bodyText = stripPreamble(trailerFree);
  // Cut off before a single heading was written: nothing usable.
  if (!/^#{1,4}\s+\S/m.test(bodyText)) return fail(cutShort ? 'empty_briefing' : 'research_failed', records, header);

  const noRedirects = new Map<number, string>();
  const retrieved = buildRetrievedSet(grounding, noRedirects, records, subject);
  // Review pages from sites that are not trusted platforms are not sources.
  for (const [key, entry] of retrieved) if (isUntrustedReviewPage(entry.url)) retrieved.delete(key);
  const redirects = redirectMap(grounding.chunks, noRedirects);
  const roleTokens = companyTokens(profileCompanies(bodyText));
  const evidence = await gatherLinkEvidence(bodyText, records, redirects, retrieved, { name: subject.name, company: subject.company, extraTokens: roleTokens });
  for (const page of evidence.verifiedPages) {
    const key = urlKey(page.url);
    if (key && !retrieved.has(key)) retrieved.set(key, page);
  }

  // The app reads the cited pages itself. `pages` holds only what our own fetch returned and feeds the
  // checks that can DROP something; `pagesWithExcerpts` adds the search excerpts and feeds only the
  // checks that ADD something (a source chip, "this page names the subject").
  const tokens = subjectTokens({ name: subject.name, company: subject.company, extraTokens: roleTokens });
  const registerPages = [...evidence.verifiedCompanyNumbers].map((n) => `https://find-and-update.company-information.service.gov.uk/company/${n}`);
  const pages = await readPages([...pageCandidates(retrieved, subject.website), ...registerPages]);
  const pagesWithExcerpts = new Map<string, CachedPage>(pages);
  let excerptPages = 0;
  for (const [url, excerpt] of grounding.excerpts) {
    const key = urlKey(url);
    if (!key) continue;
    excerptPages += 1;
    const text = excerpt.toLowerCase().replace(/\s+/g, ' ');
    const existing = pagesWithExcerpts.get(key);
    const title = grounding.chunks.find((c) => c.uri === url)?.title ?? existing?.title ?? '';
    if (existing && existing.status === 'read') pagesWithExcerpts.set(key, { ...existing, text: `${existing.text} ${text}` });
    else pagesWithExcerpts.set(key, { url, key, status: 'read', title, text, profileLinks: existing?.profileLinks ?? [] });
  }
  const pagesRead = [...pages.values()].filter((p) => p.status === 'read').length;
  // For the checks that can REMOVE a sentence: only pages the app read itself count as "read", and the
  // search excerpt of the same page is added to their text, so a figure the search returned is never
  // dropped because our own fetch got a thinner copy of the page (a script-rendered page, a cookie wall).
  const pagesForDrops = new Map<string, CachedPage>();
  for (const [key, page] of pages) {
    const withExcerpt = pagesWithExcerpts.get(key);
    pagesForDrops.set(key, page.status === 'read' && withExcerpt ? { ...page, text: withExcerpt.text } : page);
  }

  const { text: linkedText, validation: linkValidation } = validateBriefingText(
    bodyText,
    retrieved,
    records,
    { searchQueries: [], ownerMarkers: [] },
    redirects,
    evidence.verifiedCompanyNumbers,
    { pages: pagesWithExcerpts, subjectTokens: tokens, ownerName: null },
  );
  const figures = verifyFigures(linkedText, pagesForDrops, tokens);
  const location = verifyLocation(figures.text, pagesWithExcerpts, records, tokens);
  const origin = stripOriginClaims(location.text);
  const registry = ensureRegistryLines(origin.text, registryLines(records));
  const routineDomain = dropRoutineDomainLines(registry.text, records);
  const handles = dropUnsourcedHandles(routineDomain.text);
  const ratings = dropUntrustedRatings(handles.text);
  const stack = dropTechStack(ratings.text);
  const absence = dropAbsenceClaims(stack.text);
  const tidy = dropEmptySections(absence.text).text;
  const identityHosts = [hostOfUrl(subject.website)].filter(Boolean);
  // Jinna places extra source chips by matching page text to sentences. With excerpts instead of
  // sentence-level grounding that match is too loose to show as a source, so it is not done here:
  // the only citations on the card are the ones the model wrote, each checked against the pages the
  // search actually returned (validateBriefingText above).
  const text = citationsToChips(tidy, retrieved, subject.name).replace(/[ \t]+$/gm, '');

  // Identity, as far as the evidence goes: how many pages we hold actually name the subject, and
  // whether any of them also carries an anchor the visitor gave (company, site, city).
  const held = [...pagesWithExcerpts.values()].filter((p) => p.status === 'read');
  const nameTokens = subjectTokens({ name: subject.name });
  const naming = held.filter((p) => pageNamesSubject(p, nameTokens));
  const anchorTokens = [
    ...(subject.company ? subject.company.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4) : []),
    ...(subject.location ? subject.location.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4) : []),
    ...(identityHosts.length ? [identityHosts[0].split('.')[0]] : []),
  ];
  const anchoredPages = anchorTokens.length > 0 ? naming.filter((p) => anchorTokens.some((t) => p.text.includes(t) || p.url.toLowerCase().includes(t))) : [];
  const hasRegisterMatch = records.some((r) => r.source === 'companies_house');
  const identity: 'anchored' | 'name_only' | 'unconfirmed' =
    anchoredPages.length > 0 || (subject.type === 'company' && (hasRegisterMatch || identityHosts.length > 0) && naming.length > 0)
      ? 'anchored'
      : naming.length > 0
      ? 'name_only'
      : 'unconfirmed';
  const identityNote =
    identity === 'anchored'
      ? null
      : identity === 'name_only'
      ? `The pages found carry the name "${subject.name}", but none of them also carries a company, website or city you gave. They may describe a different ${subject.type === 'person' ? 'person' : 'business'} with the same name.`
      : `None of the pages this check could read names "${subject.name}". Treat the report as unconfirmed.`;

  const checksNotRun: CheckNotRun[] = [
    { check: 'Sentence-level sourcing', why: 'The search service does not say which sentence rests on which page. A source shown under a section is one the model cited and the search really returned; it is not proof that the page supports every word of the sentence.' },
    { check: 'Same-name (namesake) filter', why: 'It needs sentence-level sourcing. Identity is shown above instead.' },
    { check: 'Search query review', why: 'The search queries the model issued are not returned.' },
    ...(coverage.filter((c) => c.state === 'not_searched' || c.state === 'source_unavailable').map((c) => ({ check: c.source === 'companies_house' ? 'UK company register (API)' : c.source === 'opensanctions' ? 'Sanctions and watch lists' : c.source === 'rdap' ? 'Domain registration' : "The subject's own website", why: c.detail }))),
  ];

  const cleanedEntities: BriefingEntities = {
    people: entities.people.filter((n) => n.trim().length >= 3 && /\s/.test(n.trim()) && !/[()]/.test(n)),
    companies: entities.companies.filter((n) => n.trim().length >= 3 && !/[()]/.test(n)),
  };

  const validation: Record<string, unknown> = {
    ...linkValidation,
    entities: cleanedEntities,
    pages_read: pagesRead,
    pages_unread: pages.size - pagesRead,
    excerpt_pages: excerptPages,
    figures_checked: figures.checked,
    figures_dropped: figures.dropped,
    location: location.location,
    location_outcome: location.outcome,
    origin_dropped: origin.dropped,
    registry_lines_appended: registry.appended,
    domain_lines_dropped: routineDomain.dropped,
    handles_dropped: handles.dropped,
    stack_lines_dropped: stack.dropped,
    absence_lines_dropped: absence.dropped,
    untrusted_ratings_dropped: ratings.dropped,
    checks_not_run: checksNotRun.map((c) => c.check),
  };

  console.log(
    `[checkcheck] run=${input.runId} status=${cutShort ? 'partial' : 'complete'} type=${subject.type} cited=${grounding.chunks.length} excerpts=${excerptPages} pagesRead=${pagesRead}/${pages.size} ` +
      `links=${linkValidation.links_kept}/${linkValidation.links_total} stripped=${linkValidation.links_stripped} figuresDropped=${figures.dropped.length}/${figures.checked} identity=${identity} wallMs=${Date.now() - startedAt}`,
  );

  return {
    ...base,
    status: cutShort ? 'partial' : 'complete',
    stop_reason: cutShort ? 'partial_result' : null,
    briefing_text: `${text}${formatSourcesChecked(retrieved, new Date())}`,
    header,
    records,
    validation,
    models: models({ finish_reason: grounding.finishReason, searches: grounding.usage.searches, wall_ms: Date.now() - startedAt }),
    completed_at: new Date().toISOString(),
    cost: { ...totalCost(lines), lines },
    evidence: {
      pages_cited: grounding.chunks.length,
      pages_with_excerpts: excerptPages,
      pages_read_by_app: pagesRead,
      pages_naming_subject: naming.length,
      figures_checked: figures.checked,
      figures_removed: figures.dropped.length,
      links_checked: linkValidation.links_total,
      links_removed: linkValidation.links_stripped,
      identity,
      identity_note: identityNote,
      checks_not_run: checksNotRun,
    },
  };
}

// ── Sharing ────────────────────────────────────────────────────────────────────────────────────

const SECTION_HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** Sentences that address the reader ("you", "your") describe the reader's situation, not the subject. */
const SECOND_PERSON = /\b(?:you|your|yours|you're|you've|you'll|yourself)\b/i;

function wordsOf(s: string): string[] {
  return s.toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

/**
 * The copy of a report that a share link shows. Three layers, because removing the raw request is
 * not enough on its own:
 *   1. the "For your situation" section is removed whole (the prompt confines the reader's
 *      situation to it);
 *   2. any remaining sentence that addresses the reader in the second person is removed;
 *   3. any remaining sentence that repeats five or more consecutive words of the request is removed
 *      (the subject's own name does not count).
 * The raw request, the e-mail hash and the cost breakdown are never part of the shared copy.
 */
export function sanitizeBriefingForShare(briefing: string, userRequest: string, subjectName: string): { text: string; removed: number } {
  const nameWords = new Set(wordsOf(subjectName));
  const requestWords = wordsOf(userRequest);
  const grams = new Set<string>();
  for (let i = 0; i + 5 <= requestWords.length; i += 1) {
    const gram = requestWords.slice(i, i + 5);
    if (gram.every((w) => nameWords.has(w))) continue;
    grams.add(gram.join(' '));
  }
  const repeatsRequest = (sentence: string): boolean => {
    const words = wordsOf(sentence);
    for (let i = 0; i + 5 <= words.length; i += 1) if (grams.has(words.slice(i, i + 5).join(' '))) return true;
    return false;
  };

  let removed = 0;
  const out: string[] = [];
  let skipping = false;
  let inSources = false;
  for (const line of briefing.split('\n')) {
    const heading = SECTION_HEADING.exec(line.trim());
    if (heading) {
      skipping = heading[1].trim().toLowerCase() === PRIVATE_SECTION_TITLE.toLowerCase();
      if (skipping) removed += 1;
    }
    if (/^\*\*Sources checked/i.test(line.trim())) {
      skipping = false;
      inSources = true;
    }
    if (skipping) continue;
    if (heading || inSources || !line.trim() || /^\s*(?:Name|Location|Current role|Previous role|Links)\s*:/i.test(line)) {
      out.push(line);
      continue;
    }
    // Sentence by sentence; a Markdown link after a sentence stays with it.
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z"“(\[])/);
    const kept = sentences.filter((s) => {
      const bad = SECOND_PERSON.test(s.replace(/\[[^\]]*\]\([^)]*\)/g, ' ')) || repeatsRequest(s);
      if (bad) removed += 1;
      return !bad;
    });
    if (kept.length > 0) out.push(kept.join(' '));
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

export interface SharedReport {
  id: string;
  status: 'complete' | 'partial';
  subject: { name: string; type: 'person' | 'company'; website?: string; profile_url?: string; company?: string; location?: string };
  briefing_text: string;
  header: CheckHeader | null;
  validation: Record<string, unknown> | null;
  evidence: FinishedRun['evidence'];
  completed_at: string;
  shared_at: string;
}

export function toSharedReport(run: FinishedRun, shareId: string): SharedReport | null {
  if ((run.status !== 'complete' && run.status !== 'partial') || !run.briefing_text) return null;
  const { text } = sanitizeBriefingForShare(run.briefing_text, run.user_request ?? '', run.subject.name);
  const { name, type, website, profile_url, company, location } = run.subject;
  return {
    id: shareId,
    status: run.status,
    subject: { name, type, ...(website && { website }), ...(profile_url && { profile_url }), ...(company && { company }), ...(location && { location }) },
    briefing_text: text,
    header: run.header,
    validation: run.validation,
    evidence: run.evidence,
    completed_at: run.completed_at,
    shared_at: new Date().toISOString(),
  };
}
