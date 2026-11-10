/**
 * Private usage counters and the private request log.
 *
 * Counters are numbers only. The request log (operator decision, 2026-11-10) keeps, for each request
 * to /api/check: the time, the visitor's country, the request as typed, and how it ended. It never
 * keeps an IP address. It is capped (newest 5,000 entries) and expires 90 days after the last write.
 * The page tells visitors that requests are logged.
 *
 * Each event adds one to a per-day counter (kept about 13 months) and to an all-time counter.
 * A unique visitor is counted with a one-day marker keyed by a salted hash of the address; the
 * marker says "seen today" and nothing else. Nothing here is exposed over HTTP: the numbers are
 * read from the store with `scripts/stats.ts`.
 *
 * Counting never breaks a request: every failure is swallowed.
 */
import type { Store } from './store';
import { ipKey } from './limits';

export const STAT_NAMES = [
  'visits',
  'visitors',
  'checks_started',
  'checks_completed',
  'checks_partial',
  'checks_failed',
  'subject_person',
  'subject_company',
  'clarify_before_research',
  'clarify_from_research',
  'refused_purpose',
  'declined',
  'limit_hit',
  'errors',
  'shares_created',
  'share_opens',
  'spend_micro_usd',
] as const;
export type StatName = (typeof STAT_NAMES)[number];

const DAY_TTL = 400 * 86_400;
const TOTAL_TTL = 3650 * 86_400;
export const statDay = (date = new Date()): string => date.toISOString().slice(0, 10);

export async function bump(store: Store, name: StatName, by = 1): Promise<void> {
  if (!by) return;
  try {
    await Promise.all([store.incrBy(`stats:${statDay()}:${name}`, by, DAY_TTL), store.incrBy(`stats:total:${name}`, by, TOTAL_TTL)]);
  } catch {
    /* statistics are best-effort */
  }
}

/** One page view; the first view of the day from an address also counts one visitor. */
export async function countVisit(store: Store, ip: string): Promise<void> {
  try {
    await bump(store, 'visits');
    const seen = await store.incrBy(`seen:${statDay()}:${ipKey(ip)}`, 1, 90_000);
    if (seen === 1) await bump(store, 'visitors');
  } catch {
    /* best-effort */
  }
}

export type StatValues = Record<StatName, number>;

export async function readStats(store: Store, days: number): Promise<{ days: Array<{ day: string; values: StatValues }>; total: StatValues }> {
  const read = async (scope: string): Promise<StatValues> => {
    const values = await Promise.all(STAT_NAMES.map((n) => store.getJson<number>(`stats:${scope}:${n}`).catch(() => null)));
    return Object.fromEntries(STAT_NAMES.map((n, i) => [n, Number(values[i] ?? 0) || 0])) as StatValues;
  };
  const list: Array<{ day: string; values: StatValues }> = [];
  for (let i = 0; i < days; i += 1) {
    const day = statDay(new Date(Date.now() - i * 86_400_000));
    list.push({ day, values: await read(day) });
  }
  return { days: list, total: await read('total') };
}

// ── Request log ────────────────────────────────────────────────────────────────────────────────

export interface RequestLogEntry {
  at: string;
  /** Two-letter country code from the host's geolocation header, or null when the host gives none. */
  country: string | null;
  request: string;
  /** The visitor's answer to a clarifying question, when this request carried one. */
  answer: string | null;
  /** How it ended: complete, partial, failed:<reason>, needs_clarification, clarify:details, clarify:subject, refused:<reason>, limit:<code>, declined, error:<kind>. */
  status: string;
  subject: string | null;
  subject_type: 'person' | 'company' | null;
  cost_usd: number | null;
  ms: number;
}

const LOG_KEY = 'log:requests';
const LOG_MAX = 5000;
const LOG_TTL = 90 * 86_400;

export async function logRequest(store: Store, entry: RequestLogEntry): Promise<void> {
  try {
    await store.pushLog(LOG_KEY, entry, LOG_MAX, LOG_TTL);
  } catch {
    /* best-effort */
  }
}

export async function readRequestLog(store: Store, count: number): Promise<RequestLogEntry[]> {
  return store.readLog<RequestLogEntry>(LOG_KEY, count);
}
