/**
 * Exercises the configured store against the real backend (run with STORE_DRIVER=redis and the
 * Redis REST variables set): JSON round-trip, expiry, and atomic counters under concurrency.
 *
 *   npx tsx --env-file=.env.local scripts/test-store.ts
 */
import { randomBytes } from 'node:crypto';
import { getStore } from '../server/store';
import { admit, settle, todaySpendUsd } from '../server/limits';

const store = getStore();
const tag = randomBytes(4).toString('hex');
let failed = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log(`driver: ${store.driver}`);
await store.setJson(`test:${tag}:json`, { a: 1, text: 'héllo' }, 60);
ok('JSON round-trip', JSON.stringify(await store.getJson(`test:${tag}:json`)) === JSON.stringify({ a: 1, text: 'héllo' }));
ok('missing key reads as null', (await store.getJson(`test:${tag}:nope`)) === null);

const N = 40;
const values = await Promise.all(Array.from({ length: N }, () => store.incrBy(`test:${tag}:counter`, 1, 60)));
const final = await store.incrBy(`test:${tag}:counter`, 0, 60);
ok(`${N} concurrent increments end at ${N}`, final === N, `final ${final}`);
ok('every concurrent increment saw a distinct value', new Set(values).size === N);
ok('negative increment', (await store.incrBy(`test:${tag}:counter`, -N, 60)) === 0);

await store.setJson(`test:${tag}:ttl`, 'x', 1);
await new Promise((r) => setTimeout(r, 2200));
ok('a key with a 1 s lifetime is gone after 2 s', (await store.getJson(`test:${tag}:ttl`)) === null);

// The spending cap under a race: with room for exactly 3 reservations, 10 simultaneous requests admit exactly 3.
const before = await todaySpendUsd(store);
process.env.CHECK_RESERVE_USD = '0.05';
process.env.DAILY_SPEND_CAP_USD = String(before + 0.15 + 0.001);
process.env.CHECKS_PER_IP_PER_HOUR = '1000';
process.env.DAILY_CHECK_CAP = '100000';
const admissions = await Promise.all(Array.from({ length: 10 }, (_, i) => admit(store, `test-${tag}-${i}`)));
const admitted = admissions.filter((a) => a.ok);
ok('10 racing requests against room for 3: exactly 3 admitted', admitted.length === 3, `${admitted.length} admitted`);
ok('the rest are refused with spend_cap', admissions.filter((a) => !a.ok && a.code === 'spend_cap').length === 7);
// Return the test reservations and the test check counts so the day's real figures are unchanged.
for (const a of admitted) if (a.ok) await settle(store, a.reservedMicro, 0, true);
await store.incrBy(`checks:${new Date().toISOString().slice(0, 10)}`, -admitted.length, 90_000);
const after = await todaySpendUsd(store);
ok('reservations are released on settle', Math.abs(after - before) < 1e-9, `before ${before} after ${after}`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
