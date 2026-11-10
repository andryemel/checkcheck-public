/**
 * Verification against the pages the run actually retrieved (plan 2026-09-30, Phase A
 * items 3–5). Pure: text and a page cache in, text and counts out. The rule that governs
 * every check here is FOUND-ABSENT ONLY: a claim goes only when a page that was read
 * does not carry it; when no page could be read, or the relevant page is unread, the
 * claim stays. Quality is the priority, and recall must not pay for precision.
 *
 *  - figures: a sentence with a number that no read page contains is dropped
 *    (numbers under 10 are exempt — durations and small counts are often derived;
 *    the cited page is checked first, then every read page);
 *  - location: the Profile "Location:" line stays when a read page, the subject's
 *    own site, or a register record carries the city; otherwise it is dropped;
 *  - origin: sentences stating nationality, citizenship or origin are dropped
 *    (prompt rule, enforced here).
 */
import type { CachedPage } from './pageCache';
import { pageFor, readPagesOf } from './pageCache';
import type { ProvidedRecord } from './types';

const NUMBER_TOKEN = /(?<![\p{L}\p{N}_\-/:])(?:[$£€]\s?)?(\d(?:[\d,]*\d)?(?:\.\d+)?)(?:\s?(million|billion|bn|m|k|thousand|%|percent))?(?![\p{L}\p{N}_\-/:])/giu;
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
const MIN_VALUE = 10;

const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
// Identifiers, not figures: "company number 15664165", "SIC 56102", "No. 12", "code 62090", a postcode, a phone number.
const IDENTIFIER_BEFORE = /(\b(number|no\.?|nos?\.?|sic|code|codes|ref|reference|id)|#|\+)\s*$/i;
const POSTCODE_AFTER = /^\s?[A-Z]{1,2}\b/;
const PHONE_AFTER = /^\s\(?\d{3,4}\)?\b/; // "… 4538 9193": another digit group follows
const PHONE_BEFORE = /\d{2,4}\s$/; // "+44 20 …": a digit group precedes
const STREET_AFTER = /^\s[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s(?:Road|Street|Lane|Avenue|Place|Square|Row|Way|Drive|Court|Terrace|Gardens|Crescent|Hill|Rd|St|Ave)\b/; // "47 Shirland Road"

/**
 * Figures worth checking: amounts, counts, percentages. Years (1900–2100) and the day of a
 * date ("23 July 2026", "July 23, 2026") are left alone — they are the commonest derived
 * or paraphrased numbers, and dropping a whole sentence for them lost real content on the
 * first round-2 run.
 */
export function numbersIn(sentence: string): Array<{ raw: string; unit: string | null }> {
  const out: Array<{ raw: string; unit: string | null }> = [];
  const plain = sentence.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '$1'); // numbers inside URLs never count
  for (const m of plain.matchAll(NUMBER_TOKEN)) {
    const raw = m[1];
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value) || value < MIN_VALUE) continue;
    if (!m[2] && !raw.includes(",") && Number.isInteger(value) && value >= 1900 && value <= 2100) continue; // a year ("2,000" with a comma is a count)
    const before = plain.slice(Math.max(0, (m.index ?? 0) - 14), m.index ?? 0);
    const after = plain.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    if (!m[2] && value <= 31 && (MONTH.test(before) || MONTH.test(after))) continue; // the day of a date
    if (!m[2] && !raw.includes(',') && !raw.includes('.') && raw.length >= 5) continue; // a bare 5+ digit run is an id (company number, phone, SIC)
    if (!m[2] && (IDENTIFIER_BEFORE.test(before) || POSTCODE_AFTER.test(after) || PHONE_AFTER.test(after) || PHONE_BEFORE.test(before) || STREET_AFTER.test(after))) continue; // ids, postcodes, phones, house numbers
    out.push({ raw, unit: m[2]?.toLowerCase() ?? null });
  }
  return out;
}

/** The forms a figure may take on a page: "15,000" / "15000" / "15k"; "170 million" / "170m" / "170M"; "$1.2 billion" / "1.2bn". */
export function figureForms(raw: string, unit: string | null): string[] {
  const plain = raw.replace(/,/g, '');
  const forms = new Set<string>([raw.toLowerCase(), plain]);
  const n = Number(plain);
  if (Number.isFinite(n) && Number.isInteger(n)) {
    forms.add(n.toLocaleString('en-US'));
    if (n >= 1000 && n % 1000 === 0) forms.add(`${n / 1000}k`);
    if (n >= 1_000_000 && n % 1_000_000 === 0) forms.add(`${n / 1_000_000} million`), forms.add(`${n / 1_000_000}m`);
  }
  if (unit === 'million' || unit === 'm') forms.add(`${plain} million`), forms.add(`${plain}m`), forms.add(`${plain}mn`);
  if (unit === 'billion' || unit === 'bn') forms.add(`${plain} billion`), forms.add(`${plain}bn`), forms.add(`${plain}b`);
  if (unit === 'thousand' || unit === 'k') forms.add(`${plain} thousand`), forms.add(`${plain}k`);
  if (unit === '%' || unit === 'percent') forms.add(`${plain}%`), forms.add(`${plain} percent`), forms.add(`${plain} per cent`);
  return [...forms].map((f) => f.toLowerCase());
}

function pageHas(page: CachedPage, forms: string[]): boolean {
  return forms.some((f) => page.text.includes(f));
}

export interface FigureResult {
  text: string;
  dropped: string[];
  checked: number;
}

/** Sentences of a line (a bullet keeps its marker on the first sentence). */
function splitSentences(body: string): string[] {
  return body.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z"'(\[])/);
}

/**
 * A page counts as evidence only when it names the subject: a news site that answers 200 with a
 * consent shell or a listing (round 2: fintechnews.sg returned 11k chars with no subject name and no
 * "million") is not the article, and treating it as read called a true figure absent.
 */
function evidencePages(cache: ReadonlyMap<string, CachedPage>, tokens: string[]): { read: CachedPage[]; everythingRead: boolean } {
  const names = (p: CachedPage) => tokens.length === 0 || tokens.some((t) => p.title.toLowerCase().includes(t) || p.text.includes(t));
  const read = readPagesOf(cache).filter(names);
  return { read, everythingRead: [...cache.values()].every((p) => p.status === 'read' && names(p)) };
}

export function verifyFigures(text: string, cache: ReadonlyMap<string, CachedPage>, tokens: string[] = []): FigureResult {
  const { read } = evidencePages(cache, tokens);
  if (read.length === 0) return { text, dropped: [], checked: 0 };
  const dropped: string[] = [];
  let checked = 0;
  const lines = text.split('\n').map((line) => {
    if (/^\s*#/.test(line) || /\*\*Sources checked/.test(line)) return line;
    const bullet = /^(\s*(?:[-*+]\s+)?)(.*)$/.exec(line);
    const prefix = bullet?.[1] ?? '';
    const body = bullet?.[2] ?? line;
    // A bold "Label:" line (Scale: …, Currently: …) is one sentence for this purpose.
    const sentences = /^(\*\*|__)?[^:]{1,30}:/.test(body) ? [body] : splitSentences(body);
    const kept = sentences.filter((sentence) => {
      const numbers = numbersIn(sentence);
      if (numbers.length === 0) return true;
      checked += 1;
      const citedAll = [...sentence.matchAll(MARKDOWN_LINK)].map((m) => pageFor(cache, m[1])).filter((p): p is CachedPage => !!p);
      const cited = citedAll.filter((p) => read.includes(p));
      // The sentence cites a page the app could not read: unknown, never absent.
      if (citedAll.length > 0 && cited.length === 0) return true;
      // An uncited figure is never dropped (round 2, 2026-09-30: the rule "absent from every page we read"
      // deleted EVC's true cheque size, which the model had from a page the run did not retrieve). Only a
      // figure the model ATTRIBUTES to a page that was read and does not carry it is a distortion.
      if (citedAll.length === 0) return true;
      const missing = numbers.filter(({ raw, unit }) => !read.some((page) => pageHas(page, figureForms(raw, unit))));
      if (missing.length === 0) return true;
      dropped.push(sentence.trim());
      return false;
    });
    if (kept.length === sentences.length) return line;
    return kept.length ? prefix + kept.join(' ') : null;
  });
  return { text: lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped, checked };
}

export interface LocationResult {
  text: string;
  location: string | null;
  outcome: 'kept' | 'unsupported' | 'absent' | 'unchecked';
}

export function verifyLocation(text: string, cache: ReadonlyMap<string, CachedPage>, records: ProvidedRecord[], tokens: string[] = []): LocationResult {
  let line = /^(\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*Location\s*:?\s*(?:\*\*|__)?\s*:?\s*)(.+?)\s*$/im.exec(text);
  if (!line) {
    // A label-less Profile ("Jane Example" / "Austin, Texas, United States"): the
    // location is the "City, Region, Country" line right after the name line.
    const profile = /^#+\s*Profile\s*\n+([^\n]+)\n([^\n]+)/m.exec(text);
    const candidate = profile?.[2]?.trim() ?? '';
    if (/^[A-Z][^:]*,\s*[A-Z][^:]*$/.test(candidate) && !/\bat\b|\bof\b|founder|director|partner|ceo/i.test(candidate)) line = [candidate, '', candidate] as unknown as RegExpExecArray;
  }
  if (!line) return { text, location: null, outcome: 'absent' };
  const location = line[2].replace(/\*\*|__/g, '').trim();
  const city = location.split(',')[0]?.trim().toLowerCase() ?? '';
  const { read } = evidencePages(cache, tokens);
  const recordText = JSON.stringify(records.map((r) => r.fields)).toLowerCase();
  if (read.length === 0 && records.length === 0) return { text, location, outcome: 'unchecked' };
  if (city.length < 3) return { text, location, outcome: 'unchecked' };
  const supported = read.some((page) => page.text.includes(city)) || recordText.includes(city);
  // Report-only since the evening of 2026-09-30 (founder: the city, state and country must show): an
  // unsupported location is recorded as such but never removed from the Profile.
  return { text, location, outcome: supported ? 'kept' : 'unsupported' };
}

const ORIGIN = /\b(originally from|a native of|native of|born in|born and raised|grew up in|hails from|nationality|citizenship|citizen of|national of|of (?:[A-Z][a-z]+ )?(?:descent|origin|heritage|extraction))\b/i;
// "is Russian-born", "is a Belarusian national", "a citizen of …": the shape must name a person's origin,
// never "is a Bay Area firm" (a first round-2 run lost EVC's description to that).
const NATIONALITY_IS = /\b(?:is|was|being)\s+(?:a|an)?\s*[A-Z][a-z]+(?:-born\b|\s+(?:national|citizen|passport holder)\b)/;

export function stripOriginClaims(text: string): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const out = text
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return line;
      const bullet = /^(\s*(?:[-*+]\s+)?)(.*)$/.exec(line);
      const prefix = bullet?.[1] ?? '';
      const body = bullet?.[2] ?? line;
      // A "Nationality: X" label line goes whole.
      if (/^(\*\*|__)?\s*(nationality|citizenship|origin|born)\s*:?\s*(\*\*|__)?/i.test(body)) { dropped.push(body); return null; }
      const sentences = splitSentences(body);
      const kept = sentences.filter((s) => {
        const hit = ORIGIN.test(s) || NATIONALITY_IS.test(s);
        if (hit) dropped.push(s.trim());
        return !hit;
      });
      if (kept.length === sentences.length) return line;
      return kept.length ? prefix + kept.join(' ') : null;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, dropped };
}
