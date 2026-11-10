/**
 * UK Companies House Public Data API — the strongest single source for a UK
 * company (free key, 600 requests / 5 min; Crown copyright, reusable).
 *
 * What one record PROVES: registered name and number, status (active /
 * dissolved / liquidation …), incorporation date, registered office, SIC
 * codes, whether accounts or the confirmation statement are overdue, whether
 * the register holds insolvency history, and the officers in their registered
 * role. Nothing else — the note on the record says so.
 *
 * Resolution is cardinality, not confidence (the document-target rule): the
 * subject is resolved to ONE company only when exactly one search result has
 * the same normalised name (or the user typed the number). Several exact
 * matches, or near matches only, are returned as CANDIDATES for the
 * clarification question — never picked.
 *
 * Without `COMPANIES_HOUSE_API_KEY` the source reports `not_searched`.
 */
import type { ProvidedRecord, RecordCoverage } from '../types';
import { CHECKCHECK_USER_AGENT } from './rdap';

const API_BASE = 'https://api.company-information.service.gov.uk';
const PUBLIC_BASE = 'https://find-and-update.company-information.service.gov.uk/company/';
const TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 8;

const LEGAL_SUFFIXES = /\b(ltd|limited|llp|plc|cic|inc|llc|co|company|corp|corporation|gmbh|sarl|bv)\b\.?/g;

/** Lower-case, no punctuation, no legal suffix, single spaces — the comparison key for a company name. */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CompanySearchItem {
  title: string;
  company_number: string;
  company_status: string | null;
  date_of_creation: string | null;
  address_snippet: string | null;
  company_type: string | null;
}

export interface CompaniesHouseLookup {
  records: ProvidedRecord[];
  coverage: RecordCoverage;
  resolution: 'resolved' | 'candidates' | 'none' | 'not_searched' | 'unavailable';
}

type FetchLike = typeof fetch;

function apiKey(): string | null {
  const key = (process.env.COMPANIES_HOUSE_API_KEY ?? '').trim();
  return key || null;
}

async function chGet(path: string, key: string, fetchImpl: FetchLike): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, accept: 'application/json', 'user-agent': CHECKCHECK_USER_AGENT },
      signal: controller.signal,
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export function pickSearchItems(body: unknown): CompanySearchItem[] {
  const items = ((body as { items?: unknown[] } | null)?.items ?? []) as Array<Record<string, unknown>>;
  return items
    .filter((item) => typeof item?.title === 'string' && typeof item?.company_number === 'string')
    .map((item) => ({
      title: String(item.title),
      company_number: String(item.company_number),
      company_status: typeof item.company_status === 'string' ? item.company_status : null,
      date_of_creation: typeof item.date_of_creation === 'string' ? item.date_of_creation : null,
      address_snippet: typeof item.address_snippet === 'string' ? item.address_snippet : null,
      company_type: typeof item.company_type === 'string' ? item.company_type : null,
    }));
}

/** Exactly one same-name result resolves; otherwise the same-name (or, failing that, all) results are candidates. */
export function resolveCompany(
  subjectName: string,
  items: CompanySearchItem[],
): { resolved: CompanySearchItem | null; candidates: CompanySearchItem[] } {
  const key = normaliseCompanyName(subjectName);
  if (!key) return { resolved: null, candidates: items };
  const exact = items.filter((item) => normaliseCompanyName(item.title) === key);
  if (exact.length === 1) return { resolved: exact[0], candidates: [] };
  if (exact.length > 1) return { resolved: null, candidates: exact };
  return { resolved: null, candidates: items };
}

function profileFields(profile: Record<string, unknown>, officers: Array<Record<string, unknown>>, insolvencyCount: number | null): Record<string, unknown> {
  const accounts = (profile.accounts ?? {}) as Record<string, unknown>;
  const confirmation = (profile.confirmation_statement ?? {}) as Record<string, unknown>;
  const office = (profile.registered_office_address ?? {}) as Record<string, unknown>;
  return {
    company_name: profile.company_name ?? null,
    company_number: profile.company_number ?? null,
    company_status: profile.company_status ?? null,
    company_status_detail: profile.company_status_detail ?? null,
    type: profile.type ?? null,
    date_of_creation: profile.date_of_creation ?? null,
    date_of_cessation: profile.date_of_cessation ?? null,
    sic_codes: Array.isArray(profile.sic_codes) ? profile.sic_codes : [],
    registered_office: [office.address_line_1, office.address_line_2, office.locality, office.region, office.postal_code, office.country]
      .filter((part) => typeof part === 'string' && part.trim())
      .join(', ') || null,
    accounts_next_due: accounts.next_due ?? null,
    accounts_overdue: accounts.overdue ?? null,
    confirmation_statement_overdue: confirmation.overdue ?? null,
    has_insolvency_history: profile.has_insolvency_history ?? null,
    insolvency_cases: insolvencyCount,
    has_charges: profile.has_charges ?? null,
    officers: officers.slice(0, 10).map((officer) => {
      const dob = (officer.date_of_birth ?? null) as { month?: number; year?: number } | null;
      return {
        name: officer.name ?? null,
        role: officer.officer_role ?? null,
        appointed_on: officer.appointed_on ?? null,
        resigned_on: officer.resigned_on ?? null,
        // The register publishes month and year only — shown as such, never a day, never estimated.
        born: dob && typeof dob.month === 'number' && typeof dob.year === 'number' ? { month: dob.month, year: dob.year } : null,
      };
    }),
  };
}

export async function lookupCompaniesHouse(
  subjectName: string,
  registryNumber: string | undefined,
  nextId: () => string,
  fetchImpl: FetchLike = fetch,
): Promise<CompaniesHouseLookup> {
  const key = apiKey();
  if (!key) {
    return {
      records: [],
      resolution: 'not_searched',
      coverage: { source: 'companies_house', state: 'not_searched', detail: 'UK company register not checked (no API key configured).' },
    };
  }
  const unavailable = (detail: string): CompaniesHouseLookup => ({
    records: [],
    resolution: 'unavailable',
    coverage: { source: 'companies_house', state: 'source_unavailable', detail },
  });
  try {
    let resolved: CompanySearchItem | null = null;
    let candidates: CompanySearchItem[] = [];
    const typedNumber = (registryNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^[A-Z0-9]{6,8}$/.test(typedNumber)) {
      resolved = { title: subjectName, company_number: typedNumber, company_status: null, date_of_creation: null, address_snippet: null, company_type: null };
    } else {
      const search = await chGet(`/search/companies?q=${encodeURIComponent(subjectName)}&items_per_page=${SEARCH_LIMIT}`, key, fetchImpl);
      if (search.status !== 200) return unavailable(`UK company register search answered ${search.status}.`);
      const items = pickSearchItems(search.body);
      if (items.length === 0) {
        return {
          records: [],
          resolution: 'none',
          coverage: { source: 'companies_house', state: 'searched_no_match', detail: `No UK company found under the name "${subjectName}".` },
        };
      }
      ({ resolved, candidates } = resolveCompany(subjectName, items));
    }

    if (!resolved) {
      const record: ProvidedRecord = {
        id: nextId(),
        source: 'companies_house',
        title: `UK register: ${candidates.length} possible matches for "${subjectName}"`,
        url: `https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(subjectName)}`,
        retrieved_at: new Date().toISOString(),
        fields: {
          candidates: candidates.slice(0, 5).map((item) => ({
            name: item.title,
            company_number: item.company_number,
            status: item.company_status,
            incorporated: item.date_of_creation,
            address: item.address_snippet,
          })),
        },
        note: 'Search results only: none of these is confirmed to be the subject. They may be listed as candidates for the user to pick; no fact from them may be attached to the subject.',
      };
      return {
        records: [record],
        resolution: 'candidates',
        coverage: {
          source: 'companies_house',
          state: 'needs_confirmation',
          detail: `${candidates.length} UK companies share or resemble the name; the subject is not resolved.`,
        },
      };
    }

    const number = resolved.company_number;
    const [profile, officers, insolvency] = await Promise.all([
      chGet(`/company/${encodeURIComponent(number)}`, key, fetchImpl),
      chGet(`/company/${encodeURIComponent(number)}/officers?items_per_page=10`, key, fetchImpl),
      chGet(`/company/${encodeURIComponent(number)}/insolvency`, key, fetchImpl),
    ]);
    if (profile.status !== 200 || !profile.body) return unavailable(`UK company register profile answered ${profile.status}.`);
    const officerItems = ((officers.body as { items?: unknown[] } | null)?.items ?? []) as Array<Record<string, unknown>>;
    const insolvencyCases = insolvency.status === 200
      ? (((insolvency.body as { cases?: unknown[] } | null)?.cases ?? []).length)
      : insolvency.status === 404 ? 0 : null;
    const fields = profileFields(profile.body as Record<string, unknown>, officerItems, insolvencyCases);
    const record: ProvidedRecord = {
      id: nextId(),
      source: 'companies_house',
      title: `UK register: ${String(fields.company_name ?? subjectName)} (${number})`,
      url: `${PUBLIC_BASE}${encodeURIComponent(number)}`,
      retrieved_at: new Date().toISOString(),
      fields,
      note: 'Companies House records the registered name, number, status, incorporation date, registered office, filing deadlines, insolvency history and officers in their registered role. It does not verify trading activity, quality or payment behaviour.',
    };
    return {
      records: [record],
      resolution: 'resolved',
      coverage: { source: 'companies_house', state: 'checked', detail: `UK register read for company ${number}.` },
    };
  } catch (err) {
    return unavailable(`UK company register lookup failed (${err instanceof Error ? err.name : 'error'}).`);
  }
}
