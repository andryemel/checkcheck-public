import type { ProvidedRecord } from './types';

/**
 * Two post-model filters (2026-10-02, a report review):
 *  - the domain registration (date, registrar) is routine admin for an established site and only a signal when
 *    the domain is young — a supplier whose site was registered last month is worth knowing; "jinna.ai was
 *    registered through GoDaddy in May 2025" is not. Kept when the domain is younger than YOUNG_DOMAIN_DAYS.
 *  - a personal handle ("active under the handle jexample") with no link to the platform in the same line is
 *    dropped: for a real contact it surfaces a personal account nobody verified.
 * Both work on whole bullets / sentences and never touch a line that carries something else they cannot judge.
 */
export const YOUNG_DOMAIN_DAYS = 183;

const DOMAIN_LINE = /\b(?:domain(?:\s+name)?\b[^.\n]{0,80}\bregist(?:ered|ration|rar)|registrar\b(?!\s+of\s+companies)|\bRDAP\b|GoDaddy|Namecheap|Gandi|Porkbun|Cloudflare Registrar)/i;
// "handle" as a NOUN only ("under the handle jexample", "his username is @jex", "@jex"): the verb ("helps
// landlords handle rent collection") and a trading name ("operates under the name Acme Ltd") are ordinary prose.
const HANDLE = /(?:\bunder the (?:handle|username|user ?name)\b|\b(?:the|his|her|their|same|a|an)\s+(?:handle|username)\s+(?:is\s+)?@?[A-Za-z0-9_.]{3,}|(?:^|[\s(])@[A-Za-z0-9_]{3,}\b(?![\w.-]*\.[a-z]{2,}))/i;
const SOCIAL_LINK = /\]\(https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|tiktok\.com|threads\.net|github\.com|reddit\.com|youtube\.com|linkedin\.com|t\.me|facebook\.com)\//i;

export function domainAgeDays(records: readonly ProvidedRecord[], now: Date = new Date()): number | null {
  const rdap = records.find((r) => r.source === 'rdap');
  const at = rdap?.fields && typeof (rdap.fields as Record<string, unknown>).registered_at === 'string' ? Date.parse(String((rdap.fields as Record<string, unknown>).registered_at)) : NaN;
  return Number.isFinite(at) ? Math.floor((now.getTime() - at) / 86_400_000) : null;
}

/** Splits a block into bullets / sentences, drops the ones `drop` matches, and keeps the rest exactly. */
function dropUnits(text: string, drop: (unit: string) => boolean): { text: string; dropped: number } {
  let dropped = 0;
  const out = text.split('\n').map((line) => {
    if (/^\s*#/.test(line) || !line.trim()) return line;
    if (/^\s*[-*]\s/.test(line)) { if (drop(line)) { dropped++; return null; } return line; }
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z*"(\[])/);
    const kept = sentences.filter((s) => { if (drop(s)) { dropped++; return false; } return true; });
    return kept.length ? kept.join(' ') : null;
  }).filter((l): l is string => l !== null);
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), dropped };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * How many days ago the line itself says the domain was registered, when it says so plainly: "3 weeks ago",
 * "last month", "in May 2026", "on 2026-08-14", "14 August 2026". Null when it gives no date it can be held to.
 */
export function statedAgeDays(unit: string, now: Date = new Date()): number | null {
  const ago = /\b(\d{1,3}|a|an|one|two|three|four|five|six)\s+(day|week|month|year)s?\s+ago\b/i.exec(unit);
  if (ago) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[ago[1].toLowerCase()] ?? Number(ago[1]);
    const per = { day: 1, week: 7, month: 30, year: 365 }[ago[2].toLowerCase() as 'day' | 'week' | 'month' | 'year'];
    return n * per;
  }
  if (/\b(?:this|last)\s+(?:week|month)\b|\b(?:yesterday|recently registered|newly registered)\b/i.test(unit)) return 30;
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(unit);
  const dayMonth = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i.exec(unit);
  const monthDay = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(unit);
  const monthYear = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i.exec(unit);
  let at: number | null = null;
  if (iso) at = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (dayMonth) at = Date.UTC(Number(dayMonth[3]), MONTHS.indexOf(dayMonth[2].toLowerCase()), Number(dayMonth[1]));
  else if (monthDay) at = Date.UTC(Number(monthDay[3]), MONTHS.indexOf(monthDay[1].toLowerCase()), Number(monthDay[2]));
  else if (monthYear) at = Date.UTC(Number(monthYear[2]), MONTHS.indexOf(monthYear[1].toLowerCase()), 15);
  if (at === null || !Number.isFinite(at)) return null;
  return Math.floor((now.getTime() - at) / 86_400_000);
}

export function dropRoutineDomainLines(text: string, records: readonly ProvidedRecord[], now: Date = new Date()): { text: string; dropped: number } {
  const age = domainAgeDays(records, now);
  if (age !== null && age < YOUNG_DOMAIN_DAYS) return { text, dropped: 0 };
  // No registry record (no website, or the lookup failed): the age is unknown, so a line that itself dates the
  // registration inside the young window stays — "registered three weeks ago" is the signal this filter keeps.
  return dropUnits(text, (unit) => {
    if (!DOMAIN_LINE.test(unit)) return false;
    if (age !== null) return true;
    const stated = statedAgeDays(unit, now);
    return !(stated !== null && stated >= 0 && stated < YOUNG_DOMAIN_DAYS);
  });
}

export function dropUnsourcedHandles(text: string): { text: string; dropped: number } {
  return dropUnits(text, (unit) => HANDLE.test(unit) && !SOCIAL_LINK.test(unit));
}

/**
 * A company's tech stack ("built around React, Vite, TailwindCSS and Supabase", from a hiring listing) tells the
 * reader nothing about who they deal with (founder 2026-10-02). Dropped when a bullet or sentence names two or more
 * stack technologies, or cites hiring listings for its claim.
 */
const STACK_WORDS = /\b(react|vite|tailwind(?:css)?|supabase|next\.?js|node(?:\.js)?|typescript|javascript|python|django|rails|ruby|golang|kotlin|swift|flutter|postgres(?:ql)?|mysql|mongodb|redis|aws|gcp|azure|kubernetes|docker|terraform|graphql|vue|angular|svelte|firebase|openai|gemini|llama|langchain)\b/gi;
export function dropTechStack(text: string): { text: string; dropped: number } {
  return dropUnits(text, (unit) => {
    const hits = new Set((unit.match(STACK_WORDS) ?? []).map((w) => w.toLowerCase()));
    return hits.size >= 3 || (hits.size >= 1 && /\b(?:tech(?:nical)?\s+stack|stack\s+built|hiring\s+listings?|job\s+(?:post|listing)s?)\b/i.test(unit));
  });
}

/**
 * The account has no business details (no business name, no profile text): the model can only invent a connection
 * ("If you are comparing your personal background…"). The section stays — it is always written — with one plain
 * line instead (founder 2026-10-02: the connection was nonsense on an empty account).
 */
export const NO_OWNER_CONNECTION_LINE = 'Add your business details in Settings, and Check-Check will say how they connect to you.';
export function replaceConnectionWhenNoOwner(text: string, ownerEmpty: boolean, recordsLine: string | null = null): { text: string; replaced: boolean } {
  if (!ownerEmpty) return { text, replaced: false };
  // A "# Your connection" heading or a bold-only "**Your connection**" line (the model writes both).
  const m = /^((?:#{1,4}\s*Your connection|\*\*Your connection\*\*)\s*)$/im.exec(text);
  if (!m || m.index === undefined) return { text, replaced: false };
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/\n(?:#{1,4}\s|\*\*[^*\n]+\*\*\s*(?:\n|$))/);
  const end = next >= 0 ? start + next : text.length;
  // The owner's own history with them, written by the app (kinds, counts, dates — never money), else the plain line.
  return { text: `${text.slice(0, start)}\n${recordsLine ?? NO_OWNER_CONNECTION_LINE}\n${text.slice(end)}`, replaced: true };
}


/**
 * Ratings and reviews come only from platforms people trust (founder 2026-10-02: "we trust Trustpilot, App Store,
 * Google Play, Yelp, Google Maps, TripAdvisor … not AI-generated" review sites like netizenschoice.com).
 * A sentence or bullet that states a rating or a review verdict is kept only when it names or links one of these.
 * Review pages from any other site are left out of the sources too (isUntrustedReviewPage).
 */
// A platform's own country domains, never "any second-level domain": amazon.topreviews.net is not Amazon.
const TLD = '(?:com|co\\.uk|uk|de|fr|es|it|nl|be|at|ch|ie|se|no|dk|fi|pl|pt|ca|com\\.au|co\\.nz|co\\.jp|jp|in|co\\.in|com\\.br|com\\.mx|sg|com\\.sg|ae|co\\.za)';
const host = (label: string): RegExp => new RegExp(`(^|\\.)${label}\\.${TLD}$`);

export const TRUSTED_REVIEW_PLATFORMS: ReadonlyArray<{ name: RegExp; host: RegExp }> = [
  { name: /\btrustpilot\b/i, host: /(^|\.)trustpilot\.com$/ },
  { name: /\bapp\s*store\b/i, host: /^apps\.apple\.com$/ },
  { name: /\bgoogle\s*play\b/i, host: /^play\.google\.com$/ },
  { name: /\byelp\b/i, host: host('yelp') },
  { name: /\bgoogle\s*(maps|reviews|business)\b/i, host: new RegExp(`^(?:maps\\.google\\.${TLD}|google\\.${TLD}|g\\.page)$`) },
  { name: /\btrip\s*advisor\b/i, host: host('tripadvisor') },
  { name: /\bg2\b/i, host: /(^|\.)g2\.com$/ },
  { name: /\bcapterra\b/i, host: host('capterra') },
  { name: /\bproduct\s*hunt\b/i, host: /(^|\.)producthunt\.com$/ },
  { name: /\bglassdoor\b/i, host: host('glassdoor') },
  { name: /\btrustradius\b/i, host: /(^|\.)trustradius\.com$/ },
  { name: /\bgetapp\b/i, host: host('getapp') },
  { name: /\bbooking\.com\b/i, host: /(^|\.)booking\.com$/ },
  { name: /\b(better business bureau|bbb)\b/i, host: /(^|\.)bbb\.org$/ },
  { name: /\bfeefo\b/i, host: /(^|\.)feefo\.com$/ },
  { name: /\breviews\.io\b/i, host: /(^|\.)reviews\.io$/ },
  { name: /\bamazon\b/i, host: host('amazon') },
  { name: /\bcheckatrade\b/i, host: /(^|\.)checkatrade\.com$/ },
  { name: /\bhouzz\b/i, host: host('houzz') },
];

// A score ("4.8/5", "4.8 out of 5", "5 stars") never inside a date (3/5/2021); "reviewed by an auditor" is not a review
// verdict, "reviews on G2" is.
const RATING_CLAIM = /((?<![\d/.])\d(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10)\b(?![/\d])|\b\d(?:\.\d)?[-\s]?stars?\b|\brated\b|\brating\b|\b(?:hands-on|independent|software|product)\s+(?:review|evaluation)\b|\breviews?\s+(?:from|on)\b|\breviewed\s+on\b)/i;

function ratingOnPlatform(text: string, name: RegExp): boolean {
  const n = name.source.replace(/^\\b|\\b$/g, '');
  return new RegExp(
    // "4.8/5 on Trustpilot", "rated highly on G2", "reviews on Capterra" — the score and the platform in one clause
    `(?:\\d(?:\\.\\d)?|\\brated|\\bratings?|\\breviews?|\\bstars?)[^.;]{0,25}?\\b(?:on|via|from|at)\\s+(?:the\\s+)?(?:${n})\\b`
    // "Trustpilot rating", "Google reviews average 4.6 stars", "Yelp's reviews"
    + `|\\b(?:${n})\\s+(?:ratings?|reviews?|scores?|stars?|users|reviewers)\\b|\\b(?:${n})['’]s\\s+(?:ratings?|reviews?)`
    + `|\\b(?:${n})\\b[^.;]{0,40}?\\d(?:\\.\\d)?\\s*(?:\\/\\s*(?:5|10)|out of|stars?)`,
    'i',
  ).test(text);
}

function hostsIn(unit: string): string[] {
  return [...unit.matchAll(/\]\((https?:\/\/[^\s)"]+)/g)].map((m) => { try { return new URL(m[1]).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean);
}
function isTrustedPlatformHost(host: string): boolean {
  return TRUSTED_REVIEW_PLATFORMS.some((p) => p.host.test(host));
}

export function dropUntrustedRatings(text: string): { text: string; dropped: number } {
  return dropUnits(text, (unit) => {
    if (!RATING_CLAIM.test(unit)) return false;
    const plain = unit.replace(/\]\([^)]*\)/g, ']');
    // The platform must be WHERE the rating is ("4.8 on Trustpilot", "Trustpilot rating"), not merely named in the same
    // sentence ("rated 4.9 by netizenschoice; it sells on Amazon").
    if (TRUSTED_REVIEW_PLATFORMS.some((p) => ratingOnPlatform(plain, p.name))) return false;
    if (hostsIn(unit).some(isTrustedPlatformHost)) return false;
    return true;
  });
}

/** A review / rating page on a site that is not a trusted platform: never shown as a source. */
export function isUntrustedReviewPage(url: string): boolean {
  let host = '', path = '';
  try { const u = new URL(url); host = u.hostname.toLowerCase().replace(/^www\./, ''); path = u.pathname.toLowerCase(); } catch { return false; }
  if (isTrustedPlatformHost(host)) return false;
  return /(^|[\/_-])(review|reviews|rating|ratings|vs|alternatives|best-)([\/_-]|$)/.test(path) || /review/.test(path);
}

/**
 * A section whose every sentence a filter dropped keeps only its heading ("Career" with nothing under it): the
 * heading goes too. A heading is a "#" line or a bold-only line; a section is empty when the next non-blank line
 * is another heading or the end of the text.
 */
const HEADING_LINE = /^\s*(?:#{1,4}\s+\S.*|\*\*[^*\n]+\*\*)\s*$/;
export function dropEmptySections(text: string): { text: string; dropped: number } {
  const lines = text.split('\n');
  const keep: string[] = [];
  let dropped = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (HEADING_LINE.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length || HEADING_LINE.test(lines[j])) { dropped += 1; continue; }
    }
    keep.push(lines[i]);
  }
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped };
}

/**
 * A sentence that reports what was NOT found ("no public interviews, podcast appearances or keynote talks featuring
 * X were recorded in the past 12 months", "we could not find a LinkedIn profile") tells the reader nothing and reads
 * like a gap in the research (founder 2026-10-02: "don't add such things"). The prompt already forbids them and the
 * model still writes them, so they are dropped after it writes, sentence by sentence; headings are never touched.
 */
const ABSENCE_CLAIM = new RegExp([
  // "could not find / was unable to confirm / did not locate"
  String.raw`\b(?:could\s+not|couldn'?t|cannot|can'?t|did\s+not|didn'?t|was\s+unable\s+to|were\s+unable\s+to|unable\s+to|failed\s+to)\s+(?:be\s+)?(?:find|found|locate|located|identify|identified|confirm|confirmed|verify|verified|surface)\b`,
  // "no public interviews … were recorded / found / identified"
  String.raw`\bno\s+(?:[\w'’-]+[\s,]+){0,10}?(?:were|was|have\s+been|has\s+been|could\s+be|are|is)\s+(?:\w+\s+){0,3}?(?:found|recorded|identified|located|available|published|surfaced|reported|indexed|listed|visible|turned\s+up)\b`,
  // "not found in public sources"
  String.raw`\b(?:not|none)\s+(?:\w+\s+){0,2}?(?:found|located|identified|available)\s+(?:in|on|across)\s+(?:public|the|any|available|online)\b`,
  // "there is no public record / evidence / coverage"
  String.raw`\bthere\s+(?:is|are|was|were)\s+no\s+(?:public\s+|publicly\s+available\s+|online\s+|recent\s+|further\s+|other\s+)?(?:record|records|evidence|information|mentions?|coverage|trace|interviews?|podcasts?|press|appearances?)\b`,
  // "nothing (else) was found"
  String.raw`\bnothing\s+(?:else\s+|further\s+|more\s+)?(?:was\s+|has\s+been\s+|could\s+be\s+)?(?:found|located|published|surfaced)\b`,
  // "no public interviews / no recent press"
  String.raw`\bno\s+(?:public|publicly\s+available|recent|online|notable)\s+(?:interviews?|podcasts?|appearances?|talks?|keynotes?|press|coverage|mentions?|records?|information|reviews?|profiles?)\b`,
].join('|'), 'i');

export function dropAbsenceClaims(text: string): { text: string; dropped: number } {
  return dropUnits(text, (unit) => ABSENCE_CLAIM.test(unit));
}

