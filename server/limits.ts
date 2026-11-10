/**
 * What keeps an anonymous public page from emptying the account.
 *
 *   per-IP        N checks per hour (the address is hashed with a daily salt before it is used as a key)
 *   daily checks  a hard number of checks per UTC day
 *   daily spend   a hard dollar amount per UTC day, enforced by RESERVATION: before a check starts
 *                 the worst-case cost is added to the day's counter in one atomic increment; if the
 *                 result is over the cap the reservation is returned and the check is refused. When
 *                 the check ends the reservation is replaced by the cost OpenRouter reported. Because
 *                 the test happens on the value the increment returned, two requests racing for the
 *                 last dollar cannot both pass.
 *
 * The OpenRouter key's own credit limit remains the outer wall; set it lower than the account balance.
 */
import { createHash } from 'node:crypto';
import type { Store } from './store';

const int = (name: string, fallback: number): number => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};
const usd = (name: string, fallback: number): number => {
  const v = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const config = {
  maxRequestChars: 1000,
  checksPerIpPerHour: () => int('CHECKS_PER_IP_PER_HOUR', 5),
  dailyCheckCap: () => int('DAILY_CHECK_CAP', 150),
  dailySpendCapUsd: () => usd('DAILY_SPEND_CAP_USD', 5),
  reserveUsd: () => usd('CHECK_RESERVE_USD', 0.06),
  shareTtlSeconds: () => int('SHARE_TTL_DAYS', 90) * 86_400,
  runTtlSeconds: 86_400,
};

const MICRO = 1_000_000;
const day = (): string => new Date().toISOString().slice(0, 10);
const hour = (): string => new Date().toISOString().slice(0, 13);

export function ipKey(ip: string): string {
  return createHash('sha256').update(`${day()}|${ip}`).digest('hex').slice(0, 24);
}

export type Admission =
  | { ok: true; reservedMicro: number }
  | { ok: false; code: 'rate_limited' | 'daily_cap' | 'spend_cap'; message: string };

export async function admit(store: Store, ip: string): Promise<Admission> {
  const perIp = await store.incrBy(`ip:${ipKey(ip)}:${hour()}`, 1, 3700);
  if (perIp > config.checksPerIpPerHour()) {
    return { ok: false, code: 'rate_limited', message: `You have run ${config.checksPerIpPerHour()} checks this hour, which is the limit for this demo. Please try again later.` };
  }
  const checks = await store.incrBy(`checks:${day()}`, 1, 90_000);
  if (checks > config.dailyCheckCap()) {
    await store.incrBy(`checks:${day()}`, -1, 90_000);
    return { ok: false, code: 'daily_cap', message: 'This demo has reached its number of checks for today. Please come back tomorrow.' };
  }
  const reserve = Math.round(config.reserveUsd() * MICRO);
  const spent = await store.incrBy(`spend:${day()}`, reserve, 90_000);
  if (spent > Math.round(config.dailySpendCapUsd() * MICRO)) {
    await store.incrBy(`spend:${day()}`, -reserve, 90_000);
    await store.incrBy(`checks:${day()}`, -1, 90_000);
    return { ok: false, code: 'spend_cap', message: 'This demo has used its research budget for today. Please come back tomorrow.' };
  }
  return { ok: true, reservedMicro: reserve };
}

/** Replace the reservation with what the check really cost. An unknown cost keeps the full reservation. */
export async function settle(store: Store, reservedMicro: number, actualUsd: number | null, costComplete: boolean): Promise<void> {
  if (actualUsd === null || !costComplete) return;
  const actual = Math.round(actualUsd * MICRO);
  const delta = actual - reservedMicro;
  if (delta !== 0) await store.incrBy(`spend:${day()}`, delta, 90_000);
}

export async function todaySpendUsd(store: Store): Promise<number> {
  return (await store.incrBy(`spend:${day()}`, 0, 90_000)) / MICRO;
}
