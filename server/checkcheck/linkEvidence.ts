/**
 * Extra link evidence gathered by the APP after the research call, before the
 * briefing's links are validated (2026-09-30, founder: "links for sure").
 *
 *  1. A Companies House company URL the model composed is verified against the
 *     PUBLIC register page when no API record covers it (no key is set on any
 *     environment today): the page must answer 200 and its company name must
 *     appear in the briefing. A number the model invented fails either check.
 *  2. A grounding redirect the model pasted that is NOT in this run's chunk
 *     list (Google returned no chunks on two runs today) is resolved with the
 *     same HEAD hop the chunk resolver uses, so a real citation is kept instead
 *     of stripped.
 *
 * Nothing here trusts the model: every URL is checked live, bounded and timed.
 */
import { fetchPublic } from './netGuard';
import { resolveRedirect } from './grounding';
import { CHECKCHECK_USER_AGENT } from './records/rdap';
import { PROFILE_HOSTS } from './validateBriefing';
import { hostKey, urlKey, type RetrievedUrl } from './validateReport';
import type { ProvidedRecord } from './types';

export const COMPANIES_HOUSE_HOST = 'find-and-update.company-information.service.gov.uk';
const COMPANY_URL = /https?:\/\/find-and-update\.company-information\.service\.gov\.uk\/company\/([A-Za-z0-9]{6,10})(?:\/[a-z-]+)?\/?/g;
const REDIRECT_URL = /https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_=-]+/g;
const ANY_URL = /https?:\/\/[^\s<>()\]]+/g;
const PAGE_TIMEOUT_MS = 6000;
const MAX_COMPANY_CHECKS = 3;
const MAX_REDIRECT_CHECKS = 8;
const MAX_PAGE_CHECKS = 5;

export interface LinkEvidence {
  /** Company numbers whose public register page answered and named a company the briefing mentions. */
  verifiedCompanyNumbers: Set<string>;
  /** Pasted redirect URI → the page it points at. */
  resolvedRedirects: Map<string, string>;
  /** Ordinary pages the model named that answered 200 and carry the subject's name: the site itself, a press page. */
  verifiedPages: RetrievedUrl[];
}

export interface LinkSubject {
  name: string;
  company?: string;
  /** Extra tokens a page may carry to count as about the subject — the Profile's role companies (profileCompanies.ts). */
  extraTokens?: string[];
}

/** Words of the subject's name and company (3+ letters) — a page must carry one in its title or text. */
export function subjectTokens(subject: LinkSubject): string[] {
  const words = `${subject.name} ${subject.company ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return [...new Set([...words, ...(subject.extraTokens ?? [])])].filter((w) => !['ltd', 'limited', 'llc', 'inc', 'plc', 'the', 'and', 'group'].includes(w));
}

function isProfileHost(host: string): boolean {
  return PROFILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Pages worth an app fetch: not a redirect, not a profile host (LinkedIn answers 999 to everyone), not Google, not the register, not already retrieved. */
export function pageCandidates(text: string, retrieved: ReadonlyMap<string, RetrievedUrl>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ANY_URL)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    const host = hostKey(raw);
    const key = urlKey(raw);
    if (!host || !key || seen.has(key) || retrieved.has(key)) continue;
    if (host === 'vertexaisearch.cloud.google.com' || host === 'google.com' || host === COMPANIES_HOUSE_HOST || isProfileHost(host)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out.slice(0, MAX_PAGE_CHECKS);
}

function pageNamesSubject(html: string, tokens: string[]): boolean {
  const title = (/<title>\s*([^<]+?)\s*<\/title>/i.exec(html)?.[1] ?? '').toLowerCase();
  const body = html.toLowerCase();
  return tokens.some((t) => title.includes(t)) || tokens.some((t) => body.includes(t));
}

export async function verifyPages(text: string, retrieved: ReadonlyMap<string, RetrievedUrl>, subject: LinkSubject, fetchImpl: typeof fetch = fetch): Promise<RetrievedUrl[]> {
  const tokens = subjectTokens(subject);
  if (tokens.length === 0) return [];
  const pages: RetrievedUrl[] = [];
  await Promise.all(
    pageCandidates(text, retrieved).map(async (url) => {
      const page = await fetchText(url, fetchImpl);
      if (page && page.status === 200 && pageNamesSubject(page.body, tokens)) pages.push({ url, access_level: 'page_read' });
    }),
  );
  return pages;
}

export function composedCompanyNumbers(text: string, records: ProvidedRecord[]): string[] {
  const covered = new Set(
    records
      .filter((record) => record.source === 'companies_house')
      .flatMap((record) => [...JSON.stringify(record.fields).toUpperCase().matchAll(/"([A-Z0-9]{6,10})"/g)].map((m) => m[1])),
  );
  const numbers = new Set<string>();
  for (const match of text.matchAll(COMPANY_URL)) {
    const number = match[1].toUpperCase();
    if (!covered.has(number)) numbers.add(number);
  }
  return [...numbers].slice(0, MAX_COMPANY_CHECKS);
}

/** The register page's `<title>` is "<COMPANY NAME> - Find and update company information - GOV.UK". */
export function companyNameFromRegisterPage(html: string): string | null {
  const title = /<title>\s*([^<]+?)\s*<\/title>/i.exec(html)?.[1] ?? '';
  const name = title.split(' - ')[0]?.trim();
  return name && !/find and update company information/i.test(name) ? name : null;
}

export async function fetchText(url: string, fetchImpl: typeof fetch): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const init = { method: 'GET', signal: controller.signal, headers: { 'user-agent': CHECKCHECK_USER_AGENT, accept: 'text/html' } };
    // On the real network the address must lead to the public internet at every hop (netGuard.ts); an injected fetch is a test double.
    const response = fetchImpl === fetch ? await fetchPublic(url, init) : await fetchImpl(url, { ...init, redirect: 'follow' });
    if (!response) return null;
    return { status: response.status, body: response.ok ? (await response.text()).slice(0, 20000) : '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A composed register URL verifies when the public page exists AND belongs to the subject: the
 * company name carries a subject token (Acme → ACME COFFEE HOUSE LTD), or the officers page
 * names the subject's surname. Round 2 (2026-09-30): a run invented "DWEL AI LTD, 15899996" for
 * another company — a real page, a name that matched the model's own text, and nothing to do with the subject.
 */
export async function verifyComposedCompanyNumbers(text: string, records: ProvidedRecord[], fetchImpl: typeof fetch = fetch, subject?: LinkSubject): Promise<Set<string>> {
  const verified = new Set<string>();
  const lower = text.toLowerCase();
  const tokens = subject ? subjectTokens(subject) : [];
  const surname = subject ? subject.name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? '' : '';
  await Promise.all(
    composedCompanyNumbers(text, records).map(async (number) => {
      const page = await fetchText(`https://${COMPANIES_HOUSE_HOST}/company/${number}`, fetchImpl);
      if (!page || page.status !== 200) return;
      const name = companyNameFromRegisterPage(page.body);
      if (!name || !lower.includes(name.toLowerCase())) return;
      if (tokens.length === 0) { verified.add(number); return; }
      const nameLower = name.toLowerCase();
      if (tokens.some((t) => t.length >= 4 && nameLower.includes(t))) { verified.add(number); return; }
      if (surname.length >= 3) {
        const officers = await fetchText(`https://${COMPANIES_HOUSE_HOST}/company/${number}/officers`, fetchImpl);
        if (officers && officers.status === 200 && officers.body.toLowerCase().includes(surname)) verified.add(number);
      }
    }),
  );
  return verified;
}

export async function resolvePastedRedirects(text: string, known: Map<string, string>, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pasted = [...new Set([...text.matchAll(REDIRECT_URL)].map((m) => m[0]))].filter((uri) => !known.has(uri)).slice(0, MAX_REDIRECT_CHECKS);
  await Promise.all(
    pasted.map(async (uri) => {
      const page = await resolveRedirect(uri, fetchImpl);
      if (page) out.set(uri, page);
    }),
  );
  return out;
}

export async function gatherLinkEvidence(
  text: string,
  records: ProvidedRecord[],
  knownRedirects: Map<string, string>,
  retrieved: ReadonlyMap<string, RetrievedUrl>,
  subject: LinkSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkEvidence> {
  const [verifiedCompanyNumbers, resolvedRedirects, verifiedPages] = await Promise.all([
    verifyComposedCompanyNumbers(text, records, fetchImpl, subject),
    resolvePastedRedirects(text, knownRedirects, fetchImpl),
    verifyPages(text, retrieved, subject, fetchImpl),
  ]);
  return { verifiedCompanyNumbers, resolvedRedirects, verifiedPages };
}
