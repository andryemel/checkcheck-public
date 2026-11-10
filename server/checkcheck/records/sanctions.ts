/**
 * Sanctions / PEP / regulator-list NAME match via the OpenSanctions match API
 * (OFAC SDN + Consolidated, UK Sanctions List, EU, UN, PEPs, US regulator
 * enforcement; €0.10 per query; 30-day trial key).
 *
 * What it proves: whether the NAME resembles an entry on the lists as
 * published on the date of the check. A possible match is not a determination
 * and no match is not a clearance — the fixed wording below is the only way
 * the result is described (research pass 2026-09-28: never "sanctions-cleared").
 * The prompt already forbids reporting a name-only match as a finding about
 * the subject; the record therefore carries counts and the top candidates,
 * for the coverage section and the clarification, not for the profile.
 *
 * Without `OPENSANCTIONS_API_KEY` the source reports `not_searched`.
 */
import type { ProvidedRecord, RecordCoverage, SubjectType } from '../types';
import { CHECKCHECK_USER_AGENT } from './rdap';

const MATCH_URL = 'https://api.opensanctions.org/match/default';
const TIMEOUT_MS = 8000;
const SCORE_FLOOR = 0.7;

export const SANCTIONS_WORDING =
  'Name checked against the OFAC SDN and Consolidated lists, the UK Sanctions List and the other lists OpenSanctions publishes, as of the check date. Name similarity only: a possible match is not a determination and no match is not a clearance. Verify against the list entry (aliases, date of birth, identifiers) before acting.';

export interface SanctionsLookup {
  record: ProvidedRecord | null;
  coverage: RecordCoverage;
}

interface MatchResult { id?: string; caption?: string; schema?: string; score?: number; match?: boolean; datasets?: string[] }

export function pickMatches(body: unknown): MatchResult[] {
  const responses = (body as { responses?: Record<string, { results?: MatchResult[] }> } | null)?.responses ?? {};
  const results = responses.q1?.results ?? [];
  return results.filter((result) => typeof result?.score === 'number' && (result.score as number) >= SCORE_FLOOR);
}

export async function lookupSanctions(
  name: string,
  type: SubjectType,
  nextId: () => string,
  fetchImpl: typeof fetch = fetch,
): Promise<SanctionsLookup> {
  const key = (process.env.OPENSANCTIONS_API_KEY ?? '').trim();
  if (!key) {
    return {
      record: null,
      coverage: { source: 'opensanctions', state: 'not_searched', detail: 'Sanctions lists not checked (no API key configured).' },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(MATCH_URL, {
      method: 'POST',
      headers: { authorization: `ApiKey ${key}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': CHECKCHECK_USER_AGENT },
      body: JSON.stringify({
        queries: { q1: { schema: type === 'person' ? 'Person' : 'Company', properties: { name: [name] } } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        record: null,
        coverage: { source: 'opensanctions', state: 'source_unavailable', detail: `Sanctions list service answered ${response.status}.` },
      };
    }
    const matches = pickMatches(await response.json());
    const checkedAt = new Date().toISOString();
    const record: ProvidedRecord = {
      id: nextId(),
      source: 'opensanctions',
      title: matches.length === 0 ? 'Sanctions lists: no name match' : `Sanctions lists: ${matches.length} possible name match${matches.length === 1 ? '' : 'es'}`,
      url: matches[0]?.id ? `https://www.opensanctions.org/entities/${encodeURIComponent(String(matches[0].id))}/` : 'https://www.opensanctions.org/',
      retrieved_at: checkedAt,
      fields: {
        query_name: name,
        checked_at: checkedAt,
        possible_matches: matches.slice(0, 3).map((match) => ({
          name: match.caption ?? null,
          entity_type: match.schema ?? null,
          score: match.score ?? null,
          lists: Array.isArray(match.datasets) ? match.datasets.slice(0, 5) : [],
          url: match.id ? `https://www.opensanctions.org/entities/${encodeURIComponent(String(match.id))}/` : null,
        })),
      },
      note: SANCTIONS_WORDING,
    };
    return {
      record,
      coverage: {
        source: 'opensanctions',
        state: 'checked',
        detail: matches.length === 0 ? 'No name match on the sanctions and watch lists checked.' : `${matches.length} possible name match(es) on the lists checked — name similarity only.`,
      },
    };
  } catch (err) {
    return {
      record: null,
      coverage: { source: 'opensanctions', state: 'source_unavailable', detail: `Sanctions list lookup failed (${err instanceof Error ? err.name : 'error'}).` },
    };
  } finally {
    clearTimeout(timer);
  }
}
