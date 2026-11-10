/**
 * The subject's own website as a RECORD (bench 2026-09-30: the most repeated wrong
 * facts — EVC's cheque size and community count — were on the subject's own site,
 * and the model wrote a stale search snippet instead). When a website is known
 * (given by the user, on the contact, or the email's domain), the homepage text is
 * fetched by the app and handed to the model as a provided record, so the current
 * figures are in front of it before any search. Self-published: the note says so.
 */
import { CHECKCHECK_USER_AGENT } from './rdap';
import type { ProvidedRecord, RecordCoverage } from '../types';

const TIMEOUT_MS = 6000;
const MAX_TEXT = 6000;
const MAX_TEXT_CACHE = 60000;

export function homepageText(html: string, max = MAX_TEXT_CACHE): { title: string; text: string } {
  const title = (/<title>\s*([^<]+?)\s*<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const text = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max);
  return { title, text };
}

export async function fetchWebsiteRecord(
  website: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ record: ProvidedRecord | null; coverage: RecordCoverage }> {
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'user-agent': CHECKCHECK_USER_AGENT, accept: 'text/html' } });
    if (!response.ok) return { record: null, coverage: { source: 'website', state: 'source_unavailable', detail: `The website answered ${response.status}, so its own text was not provided.` } };
    const { title, text } = homepageText((await response.text()).slice(0, 400000), MAX_TEXT);
    if (text.length < 80) return { record: null, coverage: { source: 'website', state: 'source_unavailable', detail: 'The website returned no readable text (a script-only page), so its own text was not provided.' } };
    return {
      record: {
        id,
        source: 'website',
        title: title ? `Website: ${title}` : `Website: ${url}`,
        url: response.url || url,
        retrieved_at: new Date().toISOString(),
        fields: { title, text },
        note: "The subject's own website, fetched by the app now. Self-published: figures here are what the subject says today (prefer them to older search snippets), not independent verification.",
      },
      coverage: { source: 'website', state: 'checked', detail: 'The website homepage text was read by the app and provided as a record.' },
    };
  } catch {
    return { record: null, coverage: { source: 'website', state: 'source_unavailable', detail: 'The website did not answer in time, so its own text was not provided.' } };
  } finally {
    clearTimeout(timer);
  }
}
