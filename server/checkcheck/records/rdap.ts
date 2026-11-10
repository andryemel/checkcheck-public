/**
 * Domain registration record via RDAP (the registries' own public protocol;
 * rdap.org redirects to the registry responsible for the TLD). Free, no key.
 *
 * Proves WHEN the domain was registered and by which registrar — the check
 * owners on Reddit run by hand ("registered only 7 days ago"). It says nothing
 * about the company's age (the prompt forbids that substitution) and nothing
 * about who is behind it (registrant contacts are redacted since 2018).
 *
 * Only public hostnames reach the wire, as a PATH on a fixed host — never a
 * user-supplied URL (the no-fetch posture: this is a registry lookup, not a
 * page read).
 */
import type { ProvidedRecord, RecordCoverage } from '../types';

const RDAP_BASE = 'https://rdap.org/domain/';
const TIMEOUT_MS = 8000;
/** rdap.org answers Node's default user agent with 403 (probe 2026-09-28); a named one is served. */
export const CHECKCHECK_USER_AGENT = 'Jinna CheckCheck/1.0 (+https://jinna.ai)';

/** The registrable host of a website URL or bare domain, lower-cased, or null when unusable. */
export function domainFromInput(value: string | undefined): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.local') || host === 'localhost') return null;
  // Social / profile hosts say nothing about the subject's own domain.
  if (/(^|\.)(linkedin|facebook|instagram|x|twitter|tiktok|youtube|github|behance|dribbble|medium)\.com$/.test(host)) return null;
  return host;
}

interface RdapEvent { eventAction?: string; eventDate?: string }
interface RdapEntity { roles?: string[]; vcardArray?: unknown; handle?: string; publicIds?: Array<{ type?: string; identifier?: string }> }
interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

function registrarName(entities: RdapEntity[] | undefined): string | null {
  for (const entity of entities ?? []) {
    if (!(entity.roles ?? []).includes('registrar')) continue;
    const vcard = entity.vcardArray as [string, Array<[string, unknown, string, unknown]>] | undefined;
    const fn = Array.isArray(vcard?.[1]) ? vcard[1].find((row) => row[0] === 'fn') : undefined;
    if (fn && typeof fn[3] === 'string') return fn[3];
  }
  return null;
}

export interface RdapLookup {
  record: ProvidedRecord | null;
  coverage: RecordCoverage;
}

export async function lookupDomainRegistration(
  domain: string,
  nextId: () => string,
  fetchImpl: typeof fetch = fetch,
): Promise<RdapLookup> {
  const url = `${RDAP_BASE}${encodeURIComponent(domain)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/rdap+json, application/json', 'user-agent': CHECKCHECK_USER_AGENT },
      signal: controller.signal,
    });
    if (response.status === 404) {
      return {
        record: null,
        coverage: { source: 'rdap', state: 'searched_no_match', detail: `No registration record for ${domain} in RDAP.` },
      };
    }
    if (!response.ok) {
      return {
        record: null,
        coverage: { source: 'rdap', state: 'source_unavailable', detail: `RDAP answered ${response.status} for ${domain}.` },
      };
    }
    const body = (await response.json()) as RdapDomain;
    const events = body.events ?? [];
    const eventDate = (action: string): string | null =>
      events.find((event) => event.eventAction === action)?.eventDate ?? null;
    const registered = eventDate('registration');
    const fields: Record<string, unknown> = {
      domain: body.ldhName?.toLowerCase() ?? domain,
      registered_at: registered,
      last_changed_at: eventDate('last changed'),
      expires_at: eventDate('expiration'),
      registrar: registrarName(body.entities),
      status: body.status ?? [],
    };
    return {
      record: {
        id: nextId(),
        source: 'rdap',
        title: `Domain registration: ${fields.domain}`,
        url,
        retrieved_at: new Date().toISOString(),
        fields,
        note: 'Registry record for the domain name only: when it was registered and by which registrar. It is not the age of the business and does not identify who is behind the domain.',
      },
      coverage: { source: 'rdap', state: 'checked', detail: `Registration record read for ${domain}.` },
    };
  } catch (err) {
    return {
      record: null,
      coverage: {
        source: 'rdap',
        state: 'source_unavailable',
        detail: `RDAP lookup failed for ${domain} (${err instanceof Error ? err.name : 'error'}).`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
