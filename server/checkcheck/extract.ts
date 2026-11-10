/**
 * The freeform request → who to check.
 *
 * In Jinna the Brain's `start_check` tool names the subject. This page has one text box, so one
 * small Muse Ember call (structured output, no search) reads the request. Its cost is added to
 * the check's total.
 *
 * The model's reading is never trusted on its own:
 *   - the name must occur in the visitor's own words, or the check does not start;
 *   - links and e-mail addresses are taken from the text by the app (regular expressions), not
 *     from the model, so a link can never be invented;
 *   - company and location are kept only when they occur in the text.
 */
import { chat, type CallUsage } from './openrouter';
import type { CheckSubjectInput } from './types';

export interface ExtractedRequest {
  subject: CheckSubjectInput | null;
  /** Why no subject could be read, in words for the visitor. */
  problem: string | null;
  usage: CallUsage | null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;)]*)?/gi;
const PROFILE_HOST = /(?:^|\.)(linkedin\.com|x\.com|twitter\.com|instagram\.com|facebook\.com|github\.com|crunchbase\.com|angel\.co|wellfound\.com|medium\.com|substack\.com)$/i;
const NOT_A_SITE = /^(?:e\.g|i\.e|etc|vs|inc|ltd|co|mr|mrs|dr)\.?$/i;

function toUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?)]+$/, '');
  if (NOT_A_SITE.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Links and addresses the visitor typed, read by the app itself. */
export function anchorsInText(text: string): { website?: string; profile_url?: string; email?: string } {
  const out: { website?: string; profile_url?: string; email?: string } = {};
  const email = text.match(EMAIL_RE)?.[0];
  if (email) out.email = email.toLowerCase();
  const withoutEmails = text.replace(EMAIL_RE, ' ');
  for (const raw of withoutEmails.match(URL_RE) ?? []) {
    const url = toUrl(raw);
    if (!url) continue;
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (PROFILE_HOST.test(host)) {
      if (!out.profile_url) out.profile_url = url;
    } else if (!out.website) {
      out.website = url;
    }
  }
  return out;
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word of `value` (two letters or more) occurs in the visitor's text. */
export function occursIn(value: string, text: string): boolean {
  const haystack = fold(text);
  const words = fold(value).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'company', 'location'],
  properties: {
    name: { type: 'string', description: 'The person or company to check, exactly as written in the request. Empty string if the request names nobody.' },
    type: { type: 'string', enum: ['person', 'company'] },
    company: { type: 'string', description: 'For a person: the company the request ties them to. Otherwise empty string.' },
    location: { type: 'string', description: 'City or country the request gives for the subject. Otherwise empty string.' },
  },
} as const;

const SYSTEM = `You read one request to a business background-check tool and say WHO is to be checked.
Return JSON only. Copy the name exactly as written in the request; never complete, translate or correct it, and never add a name that is not in the request. If the request names several subjects, pick the one the request is mainly about. If it names nobody (only a link, or only a placeholder such as "their name is…"), return an empty name. Use "person" for an individual and "company" for a business, organisation, fund or brand. Company and location are empty unless the request states them.`;

export async function extractRequest(requestText: string, timeoutMs = 30_000): Promise<ExtractedRequest> {
  const text = requestText.trim();
  const anchors = anchorsInText(text);
  let usage: CallUsage | null = null;
  type Reading = { name?: unknown; type?: unknown; company?: unknown; location?: unknown };
  let parsed = null as Reading | null;
  try {
    const result = await chat({
      system: SYSTEM,
      user: `REQUEST\n${text}`,
      maxOutputTokens: 600,
      temperature: 0,
      reasoningEffort: 'low',
      timeoutMs,
      jsonSchema: { name: 'check_subject', schema: SCHEMA as unknown as Record<string, unknown> },
    });
    usage = result.usage;
    const jsonText = result.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(jsonText) as Reading;
  } catch (err: unknown) {
    // No second model and no retry: without a reading the visitor is asked to name the subject plainly.
    console.warn(`[checkcheck] extraction failed: ${err instanceof Error ? err.name : 'error'}`);
    if (err instanceof Error && err.name === 'OpenRouterError') throw err;
    parsed = null;
  }

  const name = typeof parsed?.name === 'string' ? parsed.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length < 2 || name.length > 200 || !occursIn(name, text)) {
    // A link alone is a workable anchor for a company: the site's host stands in for the name.
    if (anchors.website && !name) {
      const host = new URL(anchors.website).hostname.replace(/^www\./, '');
      return { subject: { name: host, type: 'company', website: anchors.website, ...(anchors.email && { email: anchors.email }) }, problem: null, usage };
    }
    return { subject: null, problem: 'I could not tell who to check. Write the name of the person or company, and add a company, website, city or profile link if you have one.', usage };
  }
  const type: 'person' | 'company' = parsed?.type === 'person' ? 'person' : 'company';
  const company = typeof parsed?.company === 'string' ? parsed.company.trim() : '';
  const location = typeof parsed?.location === 'string' ? parsed.location.trim() : '';
  const subject: CheckSubjectInput = {
    name,
    type,
    ...(anchors.website && { website: anchors.website }),
    ...(anchors.profile_url && { profile_url: anchors.profile_url }),
    ...(anchors.email && { email: anchors.email }),
    ...(type === 'person' && company && occursIn(company, text) && fold(company) !== fold(name) && { company: company.slice(0, 200) }),
    ...(location && occursIn(location, text) && { location: location.slice(0, 200) }),
  };
  return { subject, problem: null, usage };
}
