/**
 * The link pills under a briefing's Profile (founder 2026-09-30: "links for sure").
 * Pure. Two kinds:
 *  - `verified`: a link the server's validator kept, resolved, rehomed or formatted
 *    (it matched a retrieved page, a record, or the public register page) on a host
 *    the reader wants: LinkedIn, Instagram, X, Facebook, YouTube, TikTok, GitHub,
 *    Companies House, Trustpilot, Yelp, Google Maps, and the subject's own website.
 *    An ordinary retrieved page (a news article) stays an inline link, never a pill.
 *  - `search`: app-composed navigation (a LinkedIn / Google Maps / register search).
 *    NOT shown since 2026-09-30 (founder: "remove this, don't show again"); the kind
 *    stays in the type so a caller can still tell a found link from a search.
 */
import { brandToken } from './sourcePages';

export interface CheckLinkPill {
  platform: string;
  label: string;
  url: string;
  /** The host the favicon is fetched for. */
  host: string;
  kind: 'verified' | 'search' | 'source';
}

export interface CheckLinkInput {
  subject: { name: string; type: 'person' | 'company'; company?: string; location?: string; website?: string };
  /** `final` URLs from `validation.decisions` (null = stripped). */
  finals: Array<string | null | undefined>;
  /** Pages the run retrieved (sourcePages.parseSourcePages): a company's own site among them becomes its pill. */
  sources?: Array<{ host: string; url: string }>;
  /** Names the text uses (sourcePages.namesInText). */
  textNames?: string[];
  /** The companies of the Currently / Previously lines: each gets a website pill when the run read its site. */
  companies?: string[];
}

const PLATFORMS: Array<{ platform: string; test: (host: string, path: string) => boolean }> = [
  { platform: 'LinkedIn', test: (h) => h === 'linkedin.com' || h.endsWith('.linkedin.com') },
  { platform: 'Instagram', test: (h) => h === 'instagram.com' },
  { platform: 'X', test: (h) => h === 'x.com' || h === 'twitter.com' },
  { platform: 'Facebook', test: (h) => h === 'facebook.com' },
  { platform: 'YouTube', test: (h) => h === 'youtube.com' },
  { platform: 'TikTok', test: (h) => h === 'tiktok.com' },
  { platform: 'GitHub', test: (h) => h === 'github.com' },
  { platform: 'Companies House', test: (h, p) => h === 'find-and-update.company-information.service.gov.uk' && p.startsWith('/company/') },
  { platform: 'Trustpilot', test: (h) => h === 'trustpilot.com' },
  { platform: 'Yelp', test: (h) => h === 'yelp.com' },
  { platform: 'Google Maps', test: (h, p) => (h === 'google.com' && p.startsWith('/maps')) || h === 'maps.google.com' || h === 'goo.gl' },
];

const ORDER = ['LinkedIn', 'Website', 'Instagram', 'X', 'Facebook', 'Companies House', 'Google Maps', 'Trustpilot', 'Yelp', 'YouTube', 'TikTok', 'GitHub'];

function parse(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname };
  } catch {
    return null;
  }
}

/** A LinkedIn people search is only a search: a profile URL needs the validator's evidence. */
function isLinkedInSearch(host: string, path: string): boolean {
  return host.endsWith('linkedin.com') && path.startsWith('/search/');
}

function ownSiteHost(input: CheckLinkInput): string | null {
  const site = input.subject.website ? parse(input.subject.website)?.host ?? null : null;
  return site;
}

export function buildCheckLinkPills(input: CheckLinkInput): CheckLinkPill[] {
  const finals = input.finals.filter((f): f is string => !!f);
  const pages = [...(input.sources ?? []), ...finals.map((url) => ({ host: hostOfUrl(url) ?? '', url }))].filter((s) => s.host);
  const pills: CheckLinkPill[] = [];
  const linkedIn = finals.find((url) => {
    const p = parse(url);
    return !!p && p.host.endsWith('linkedin.com') && /^\/(in|company)\//.test(p.path);
  });
  // 1. The subject, with the LinkedIn logo: the verified profile, else the closest thing — a LinkedIn search for them.
  const q = (parts: Array<string | undefined>) => encodeURIComponent(parts.filter((x): x is string => !!x && x.trim() !== '').join(' '));
  pills.push({
    platform: 'LinkedIn',
    label: input.subject.name,
    host: 'linkedin.com',
    url: linkedIn ?? `https://www.linkedin.com/search/results/all/?keywords=${q([input.subject.name, input.subject.type === 'person' ? input.subject.company : undefined])}`,
    kind: linkedIn ? 'verified' : 'search',
  });
  // 2. Each company (Currently first, then Previously; the subject itself when it is a company): its site when the run
  //    read it or the model linked it and the validator kept it, else the closest thing — a Google search for the name.
  // Founder 2026-09-30 (final): the row is LinkedIn plus the CURRENT company's site — the subject itself for a
  // business, the first (Currently) company for a person. Previous companies live in the text.
  const companies = input.subject.type === 'company' ? [input.subject.name] : (input.companies ?? []).slice(0, 1);
  const taken = new Set<string>();
  for (const company of companies) {
    const tokens = companyTokens(company);
    const key = tokens[0] ?? '';
    if (key.length < 3 || taken.has(key)) continue;
    taken.add(key);
    // "Example Venture Collective (EVC)" → the pill says "EVC"; the site may be example.vc or evc.example.
    const label = /\(([A-Za-z0-9&.-]{2,12})\)\s*$/.exec(company)?.[1] ?? company;
    const own = input.subject.website ? { host: hostOfUrl(input.subject.website) ?? '', url: input.subject.website } : null;
    const site = [...pages, ...(own && own.host ? [own] : [])].find((s) => !PLATFORMS.some((pl) => pl.test(s.host, '/')) && s.host !== 'google.com' && hostBelongsTo(s.host, tokens));
    pills.push(site
      ? { platform: 'Website', label, host: site.host, url: site.url, kind: 'verified' }
      : { platform: 'Website', label, host: 'google.com', url: `https://www.google.com/search?q=${encodeURIComponent(`"${label}"`)}`, kind: 'search' });
  }
  return pills;
}

const COMPANY_STOP = new Set(['limited', 'ltd', 'inc', 'llc', 'plc', 'group', 'company', 'partners', 'capital', 'ventures', 'venture', 'collective', 'labs', 'technologies', 'technology', 'holdings']);

/** Match tokens for a company name: the squashed whole (first), the bracketed acronym, each word of 4+ letters, the initials. */
export function companyTokens(company: string): string[] {
  const tokens: string[] = [];
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(company.trim());
  const names = paren ? [paren[1], paren[2]] : [company];
  for (const n of names) {
    const words = n.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const whole = words.join('');
    if (whole.length >= 3 && !tokens.includes(whole)) tokens.push(whole);
    for (const w of words) if (w.length >= 4 && !COMPANY_STOP.has(w) && !tokens.includes(w)) tokens.push(w);
    const acronym = words.filter((w) => !COMPANY_STOP.has(w)).map((w) => w[0]).join('');
    if (acronym.length >= 3 && acronym.length <= 5 && !tokens.includes(acronym)) tokens.push(acronym);
  }
  return tokens;
}

/** Does the host belong to the company? Its brand equals a token, or a token of 5+ letters contains it (or the reverse). */
export function hostBelongsTo(host: string, tokens: string[]): boolean {
  const brand = brandToken(host);
  if (brand.length < 3) return false;
  return tokens.some((t) => t === brand || (brand.length >= 5 && t.includes(brand)) || (t.length >= 5 && brand.includes(t)));
}

function hostOfUrl(url: string): string | null {
  return parse(url)?.host ?? null;
}

function websiteLabel(host: string, subject: CheckLinkInput['subject']): string {
  const brand = brandToken(host);
  const company = (subject.type === 'company' ? subject.name : subject.company) ?? '';
  if (company && company.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(brand.slice(0, 4))) return company;
  return brand ? brand[0].toUpperCase() + brand.slice(1) : 'Website';
}
