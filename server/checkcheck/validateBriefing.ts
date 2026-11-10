/**
 * CheckCheck briefing mode — the LINK check on the model's Markdown
 * (prompt v0.3, 2026-09-30). The prompt is the instruction; this is the control.
 *
 * Under Google grounding the model never sees a page's URL, so the links it
 * writes are guesses. Every URL in the text is matched against what was
 * actually retrieved (the same set validateReport.ts uses):
 *   kept      — exactly retrieved (host + path)
 *   resolved  — a Google grounding redirect URI the prompt told the model to
 *               preserve, replaced by the page the app resolved it to (the
 *               redirect expires; the page does not)
 *   rehomed   — a guessed path on a retrieved ORDINARY domain → the retrieved
 *               page on that domain (validateReport.rehomeOnDomain);
 *               NEVER on a profile host (linkedin, instagram, …) where the
 *               nearest path is a namesake
 *   formatted — the two shapes the prompt allows the model to compose:
 *               a Companies House /company/<number> URL whose number is in a
 *               provided record, and a google.com/search LinkedIn fallback
 *   stripped  — everything else: the link becomes its label + "(link not
 *               verified)" so the reader sees which claim lost its source
 * The claim itself stays: this mode cannot move prose to "still to establish".
 *
 * A Sources list of the retrieved pages is appended by the app (those URLs are
 * always real), and the model's Google queries are checked for owner-context
 * words (the one place the owner's context leaves Vertex).
 */
import type { ProvidedRecord } from './types';
import { hostKey, rehomeOnDomain, urlKey, type RetrievedUrl } from './validateReport';
import type { CachedPage } from './pageCache';
import { pageFor, readPagesOf } from './pageCache';

/** Hosts where one path = one person or account: exact match only. */
export const PROFILE_HOSTS: readonly string[] = [
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'threads.net',
  'github.com',
  'medium.com',
  'substack.com',
];
const COMPANIES_HOUSE_HOST = 'find-and-update.company-information.service.gov.uk';
const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

export type BriefingLinkOutcome = 'kept' | 'resolved' | 'rehomed' | 'formatted' | 'corroborated' | 'stripped';

export interface BriefingLinkDecision {
  cited: string;
  outcome: BriefingLinkOutcome;
  /** The URL the text now carries (kept / rehomed / formatted). */
  final: string | null;
}

export interface BriefingValidation {
  links_total: number;
  links_kept: number;
  links_resolved: number;
  links_rehomed: number;
  links_formatted: number;
  /** A profile URL kept because its handle appears on a page this run retrieved (bench 2026-09-30). */
  links_corroborated: number;
  links_stripped: number;
  decisions: BriefingLinkDecision[];
  /** Owner-context words found in the model's Google queries (content-free: the marker, never the query). */
  owner_context_in_queries: string[];
  search_queries: number;
  retrieved_urls: number;
}

export interface BriefingResult {
  text: string;
  validation: BriefingValidation;
}

/**
 * Since 2026-09-30 a link the validator could not prove becomes its plain label (the
 * "(link not verified)" marker read as broken; the pill row and the page checks carry
 * the evidence now). Kept as a constant for the audit of older rows.
 */
export const NOT_VERIFIED = '(link not verified)';

export interface ValidateOptions {
  /** Pages the app read after the run (pageCache.ts): destination and corroboration checks. */
  pages?: ReadonlyMap<string, CachedPage>;
  /** Lower-case name / company words (linkEvidence.subjectTokens): a page must carry one. */
  subjectTokens?: string[];
  /** The owner's name: "A and B opened the café as a couple" is owner-relation speculation too. */
  ownerName?: string | null;
}

export function pageNamesSubject(page: CachedPage, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const title = page.title.toLowerCase();
  return tokens.some((t) => title.includes(t) || page.text.includes(t));
}

/** The handle of a profile URL: linkedin.com/in/<h>, linkedin.com/company/<h>, x.com/<h>, instagram.com/<h> … (5+ chars, not all digits). */
export function profileHandle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const host = hostKey(url) ?? '';
  const raw = host.endsWith('linkedin.com') ? (parts[0] === 'in' || parts[0] === 'company' ? parts[1] : undefined) : parts[0];
  const handle = (raw ?? '').replace(/^@/, '').toLowerCase();
  if (handle.length < 5 || /^\d+$/.test(handle) || ['search', 'posts', 'pulse', 'company', 'in', 'p', 'reel', 'explore', 'hashtag', 'watch', 'status'].includes(handle)) return null;
  return handle;
}

function urlHasHandle(url: string, handle: string): boolean {
  try {
    const segments = new URL(url).pathname.toLowerCase().split('/').filter(Boolean).map((s) => s.replace(/^@/, ''));
    return segments.includes(handle);
  } catch {
    return false;
  }
}

/**
 * Owner-relation speculation never reaches the reader (bench 2026-09-30: all three Pro settings
 * inferred that the owner and the subject are related from a shared surname and Facebook birthday
 * wishes — the prompt bans it, so this is enforced here, whatever model runs). A sentence goes when
 * it addresses the owner ("you", "your") AND speaks of a relationship, family, or the surname/birthday
 * evidence such speculation rests on.
 */
const OWNER_WORDS = /\b(you|your|yours|yourself)\b/i;
const RELATION_WORDS = /\b(related|relative|relatives|relation|relationship|family|families|wife|husband|spouse|partner in life|your partner|his partner|her partner|as a couple|the couple|couple|married|marriage|brother|sister|sibling|parent|parents|parenthood|parenting|mother|father|son|daughter|children|child|kids|baby|cousin|niece|nephew|uncle|aunt|kin|birthday|personal(ly)? (connection|connected|relationship|ties?|link)|closely connected|close personal)\b/i;
const SURNAME_WORDS = /\b(shared? (a |the )?(surname|last name|family name)|same (surname|last name|family name)|surname)\b/i;
// Family life of the SUBJECT is out of scope too (prompt rule): parenthood, children, marriage — a
// co-founder described as "his wife" stays, because that names a business partner.
const SUBJECT_FAMILY = /\b(parenthood|parenting|their children|his children|her children|kids|newborn|baby|pregnan\w*|maternity|paternity|divorce\w*|wedding)\b/i;

export function stripOwnerRelationSpeculation(text: string, ownerName?: string | null): string {
  const first = (ownerName ?? '').trim().split(/\s+/)[0] ?? '';
  const ownerRe = first.length >= 3 ? new RegExp(`\\b(you|your|yours|yourself|${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i') : OWNER_WORDS;
  const cut = (sentence: string) =>
    (ownerRe.test(sentence) && (RELATION_WORDS.test(sentence) || SURNAME_WORDS.test(sentence))) ||
    (SURNAME_WORDS.test(sentence) && RELATION_WORDS.test(sentence)) ||
    SUBJECT_FAMILY.test(sentence);
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return line;
      const bullet = /^(\s*(?:[-*+]\s+)?)(.*)$/.exec(line);
      const prefix = bullet?.[1] ?? '';
      const body = bullet?.[2] ?? line;
      const sentences = body.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z"'(\[])/);
      const kept = sentences.filter((s) => !cut(s));
      if (kept.length === sentences.length) return line;
      return kept.length ? prefix + kept.join(' ') : '';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A sentence about Google redirects or search-tool limitations never reaches the
 * reader (founder 2026-09-30: "never display this"). The app resolves or drops every
 * redirect before the text is stored, so such a note is false on screen. Matched
 * per sentence or bullet, on the words the model uses for it: "redirect" or
 * "limitation" together with "source", "link", "citation", "search" or "tool".
 */
const REDIRECT_NOTE_SENTENCE = /(^|(?<=[.!?]\s))[^.!?\n]*\b(redirects?|limitations?)\b[^.!?\n]*\b(sources?|links?|citations?|search|tool|platform|access)\b[^.!?\n]*[.!?]?/gi;
const REDIRECT_NOTE_LINE = /^[\s*_-]*(?:\*{1,2}|_)?\s*Note:?[^\n]*\b(redirect|limitation)s?\b[^\n]*$/gim;

export function stripRedirectNotes(text: string): string {
  const withoutLines = text.replace(REDIRECT_NOTE_LINE, '');
  const withoutSentences = withoutLines.replace(REDIRECT_NOTE_SENTENCE, (sentence) =>
    // Only a note ABOUT the tooling goes: "a redirect of rent payments to the new platform" stays.
    /\b(redirects?|limitations?)\b/i.test(sentence) && /\b(google|search[- ]?tool|search access|tool limitations?|citations?|source links?|grounding)\b/i.test(sentence) ? '' : sentence,
  );
  // Collapse what a removed note leaves behind: a double space mid-paragraph, blank lines, a lone "*" or "**" wrapper.
  return withoutSentences.replace(/ {2,}/g, ' ').replace(/^[\s*_]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function isProfileHost(url: string): boolean {
  const host = hostKey(url);
  return !!host && PROFILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The two composed shapes the prompt allows, checked against the run's own evidence. */
export function isAllowedFormattedUrl(url: string, records: ProvidedRecord[], verifiedCompanyNumbers: ReadonlySet<string> = new Set()): boolean {
  const host = hostKey(url);
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (host === COMPANIES_HOUSE_HOST) {
    const match = /^\/company\/([A-Za-z0-9]{6,10})(?:\/(officers|persons-with-significant-control))?\/?$/.exec(parsed.pathname);
    if (!match) return false;
    const number = match[1].toUpperCase();
    // A record from the API, or the public register page checked by linkEvidence.ts.
    if (verifiedCompanyNumbers.has(number)) return true;
    return records.some((record) => record.source === 'companies_house' && JSON.stringify(record.fields).toUpperCase().includes(`"${number}"`));
  }
  if (host === 'google.com' && parsed.pathname === '/search') {
    const q = parsed.searchParams.get('q') ?? '';
    return /site:linkedin\.com\/(in|company)\//i.test(q);
  }
  return false;
}

export function decideLink(
  cited: string,
  retrieved: Map<string, RetrievedUrl>,
  records: ProvidedRecord[],
  redirects: Map<string, string> = new Map(),
  verifiedCompanyNumbers: ReadonlySet<string> = new Set(),
  options: ValidateOptions = {},
): BriefingLinkDecision {
  const key = urlKey(cited);
  if (!key) return { cited, outcome: 'stripped', final: null };
  const decision = decideLinkInner(cited, key, retrieved, records, redirects, verifiedCompanyNumbers, options);
  // Destination check (Phase A item 2): a page that was READ and does not name the subject is not
  // evidence about them, whatever the URL — the Business Insider immigration story under Nick's name.
  if (decision.final && decision.outcome !== 'formatted' && options.pages && options.subjectTokens?.length) {
    const page = pageFor(options.pages, decision.final);
    if (page && page.status === 'read' && !pageNamesSubject(page, options.subjectTokens)) return { cited, outcome: 'stripped', final: null };
  }
  return decision;
}

function decideLinkInner(
  cited: string,
  key: string,
  retrieved: Map<string, RetrievedUrl>,
  records: ProvidedRecord[],
  redirects: Map<string, string>,
  verifiedCompanyNumbers: ReadonlySet<string>,
  options: ValidateOptions,
): BriefingLinkDecision {
  if (hostKey(cited) === GROUNDING_REDIRECT_HOST) {
    // Only a redirect from THIS run's grounding chunks is known; any other is a guess.
    const page = redirects.get(cited.trim());
    return page ? { cited, outcome: 'resolved', final: page } : { cited, outcome: 'stripped', final: null };
  }
  const exact = retrieved.get(key);
  if (exact) return { cited, outcome: 'kept', final: exact.url };
  if (isAllowedFormattedUrl(cited, records, verifiedCompanyNumbers)) return { cited, outcome: 'formatted', final: cited };
  if (isProfileHost(cited)) {
    // Two signals for a profile URL the run never retrieved (plan 2026-09-30, item 10):
    //  (a) a page the app READ links to that profile (the subject's site, a press page);
    //  (b) the same handle appears on another platform's retrieved URL AND the handle carries a
    //      subject name token (jexample ↔ Example) — a coincidental johnsmith does not qualify.
    const handle = profileHandle(cited);
    if (handle) {
      const target = cited.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
      const linkedFromPage = options.pages ? readPagesOf(options.pages).some((page) => page.profileLinks.some((href) => href === target || href.endsWith(`/${handle}`) || href.includes(`/${handle}/`))) : false;
      const tokens = (options.subjectTokens ?? []).filter((t) => t.length >= 4);
      const handleNamesSubject = tokens.some((t) => handle.includes(t));
      const onAnotherPlatform = [...retrieved.values()].some((entry) => hostKey(entry.url) !== hostKey(cited) && urlHasHandle(entry.url, handle));
      if (linkedFromPage || (onAnotherPlatform && handleNamesSubject)) return { cited, outcome: 'corroborated', final: cited };
    }
  }
  if (!isProfileHost(cited)) {
    // Rehoming (a guessed path → the one page retrieved on that domain) only when that page was READ
    // and names the subject; a news outlet's unrelated article is worse than no link.
    const onDomain = rehomeOnDomain(cited, retrieved);
    if (onDomain) {
      const page = options.pages ? pageFor(options.pages, onDomain.url) : null;
      if (page && page.status === 'read' && pageNamesSubject(page, options.subjectTokens ?? [])) return { cited, outcome: 'rehomed', final: onDomain.url };
      if (!options.pages) return { cited, outcome: 'rehomed', final: onDomain.url }; // no cache (older callers / tests): the old rule
    }
  }
  return { cited, outcome: 'stripped', final: null };
}

// Markdown links first ([label](url)), then bare URLs outside them.
const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(?<![("<])https?:\/\/[^\s<>)\]]+/g;

function trimTrailingPunctuation(url: string): { url: string; tail: string } {
  const match = /[.,;:!?]+$/.exec(url);
  return match ? { url: url.slice(0, -match[0].length), tail: match[0] } : { url, tail: '' };
}

/** chunk redirect URI → the page it resolved to (researchCall.resolveChunkUrls), keyed by the exact URI the model saw. */
export function redirectMap(chunks: Array<{ index: number; uri: string }>, resolvedChunkUrls: Map<number, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of chunks) {
    const page = resolvedChunkUrls.get(chunk.index);
    if (chunk.uri && page) map.set(chunk.uri, page);
  }
  return map;
}

export function validateBriefingText(
  text: string,
  retrieved: Map<string, RetrievedUrl>,
  records: ProvidedRecord[],
  queries: { searchQueries: string[]; ownerMarkers: string[] },
  redirects: Map<string, string> = new Map(),
  verifiedCompanyNumbers: ReadonlySet<string> = new Set(),
  options: ValidateOptions = {},
): BriefingResult {
  const decisions: BriefingLinkDecision[] = [];
  let out = text.replace(MARKDOWN_LINK, (_whole, label: string, url: string) => {
    const decision = decideLink(url, retrieved, records, redirects, verifiedCompanyNumbers, options);
    decisions.push(decision);
    const plain = label.trim() || hostKey(url) || 'link';
    return decision.final ? `[${plain}](${decision.final})` : plain;
  });
  out = out.replace(BARE_URL, (raw: string) => {
    const { url, tail } = trimTrailingPunctuation(raw);
    const decision = decideLink(url, retrieved, records, redirects, verifiedCompanyNumbers, options);
    decisions.push(decision);
    if (decision.final) return `${decision.final}${tail}`;
    const host = hostKey(url) ?? 'link';
    return `${host}${tail}`;
  });

  out = stripOwnerRelationSpeculation(stripRedirectNotes(out), options.ownerName);
  const count = (outcome: BriefingLinkOutcome) => decisions.filter((d) => d.outcome === outcome).length;
  const lowerQueries = queries.searchQueries.map((q) => q.toLowerCase());
  const leaked = queries.ownerMarkers.filter((marker) => lowerQueries.some((q) => q.includes(marker)));
  return {
    text: out,
    validation: {
      links_total: decisions.length,
      links_kept: count('kept'),
      links_resolved: count('resolved'),
      links_rehomed: count('rehomed'),
      links_formatted: count('formatted'),
      links_corroborated: count('corroborated'),
      links_stripped: count('stripped'),
      decisions,
      owner_context_in_queries: leaked,
      search_queries: queries.searchQueries.length,
      retrieved_urls: retrieved.size,
    },
  };
}

/** The app's own list of what was actually retrieved — appended under the text; every URL here is real. */
export function formatSourcesChecked(retrieved: Map<string, RetrievedUrl>, checkedOn: Date): string {
  const entries = [...retrieved.values()].filter((entry) => entry.access_level !== 'provided_context');
  if (entries.length === 0) return '';
  const day = checkedOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const lines = entries.map((entry) => {
    const host = hostKey(entry.url) ?? entry.url;
    const how = entry.access_level === 'api_record' ? 'record' : entry.access_level === 'page_read' ? 'page read' : 'search result';
    return `- [${host}](${entry.url}) (${how})`;
  });
  return `\n\n**Sources checked on ${day}**\n${lines.join('\n')}`;
}
