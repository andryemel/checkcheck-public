/**
 * The pages a run retrieved, read by the app after the model answers (plan 2026-09-30,
 * Phase A item 1). Up to MAX_PAGES retrieved pages plus the subject's own site, fetched
 * in parallel with a short cap, text and outbound profile links kept in memory for the
 * verification steps (pageVerification.ts) — never stored on the row.
 *
 * A page is `read` (200 with readable text) or `unread` (blocked, timed out, script-only,
 * a profile host that answers 999 to everyone). Unread is NOT "absent": every check that
 * uses the cache treats an unread page as unknown and keeps the claim.
 */
import { fetchText } from './linkEvidence';
import { homepageText } from './records/website';
import { PROFILE_HOSTS } from './validateBriefing';
import { hostKey, urlKey, type RetrievedUrl } from './validateReport';

export interface CachedPage {
  url: string;
  key: string;
  status: 'read' | 'unread';
  title: string;
  /** Lower-cased readable text, commas kept, whitespace collapsed. */
  text: string;
  /** Outbound links to profile hosts found in the HTML (href values), lower-cased. */
  profileLinks: string[];
}

const MAX_PAGES = 16; // every retrieved page gets a chip (founder 2026-09-30): read them all, within reason
// The public register pages answer 200 and carry the company number, status and office: they are read.
const SKIP_HOSTS = ['google.com', 'vertexaisearch.cloud.google.com'];

function isProfileHost(host: string): boolean {
  return PROFILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function outboundProfileLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1].trim().toLowerCase();
    const host = hostKey(href);
    if (host && isProfileHost(host)) out.add(href.replace(/[?#].*$/, '').replace(/\/+$/, ''));
  }
  return [...out];
}

export function pageCandidates(retrieved: ReadonlyMap<string, RetrievedUrl>, website: string | undefined): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const host = hostKey(url);
    const key = urlKey(url);
    if (!host || !key || seen.has(key) || isProfileHost(host) || SKIP_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return;
    seen.add(key);
    urls.push(url);
  };
  if (website) push(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  for (const entry of retrieved.values()) {
    if (entry.access_level === 'api_record' && !/company-information\.service\.gov\.uk/.test(entry.url)) continue;
    push(entry.url);
  }
  return urls.slice(0, MAX_PAGES + (website ? 1 : 0));
}

export async function readPages(urls: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, CachedPage>> {
  const cache = new Map<string, CachedPage>();
  await Promise.all(
    urls.map(async (url) => {
      const key = urlKey(url);
      if (!key) return;
      const page = await fetchText(url, fetchImpl);
      if (!page || page.status !== 200) {
        cache.set(key, { url, key, status: 'unread', title: '', text: '', profileLinks: [] });
        return;
      }
      const { title, text } = homepageText(page.body);
      if (text.length < 80) {
        cache.set(key, { url, key, status: 'unread', title, text: '', profileLinks: [] });
        return;
      }
      cache.set(key, { url, key, status: 'read', title, text: text.toLowerCase(), profileLinks: outboundProfileLinks(page.body) });
    }),
  );
  return cache;
}

export function pageFor(cache: ReadonlyMap<string, CachedPage>, url: string): CachedPage | null {
  const key = urlKey(url);
  return key ? cache.get(key) ?? null : null;
}

export function readPagesOf(cache: ReadonlyMap<string, CachedPage>): CachedPage[] {
  return [...cache.values()].filter((p) => p.status === 'read');
}
