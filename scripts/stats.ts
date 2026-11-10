/**
 * Private usage statistics, read straight from the store. Nothing here is served over HTTP.
 *
 *   STORE_DRIVER=redis npx tsx --env-file=.env.local scripts/stats.ts [days=14]
 */
import { getStore } from '../server/store';
import { readStats, type StatValues } from '../server/stats';

const days = Math.min(90, Math.max(1, Number.parseInt(process.argv[2] ?? '14', 10) || 14));
const store = getStore();
const { days: list, total } = await readStats(store, days);
const usd = (micro: number) => `$${(micro / 1e6).toFixed(3)}`;
const pad = (v: string | number, n: number) => String(v).padStart(n);

const header = `${'day'.padEnd(10)} ${pad('visitors', 8)} ${pad('visits', 6)} ${pad('checks', 6)} ${pad('done', 5)} ${pad('failed', 6)} ${pad('asked', 5)} ${pad('refused', 7)} ${pad('limit', 5)} ${pad('shares', 6)} ${pad('opens', 5)} ${pad('spend', 8)}`;
const row = (label: string, v: StatValues) =>
  `${label.padEnd(10)} ${pad(v.visitors, 8)} ${pad(v.visits, 6)} ${pad(v.checks_started, 6)} ${pad(v.checks_completed + v.checks_partial, 5)} ${pad(v.checks_failed + v.errors, 6)} ${pad(v.clarify_before_research + v.clarify_from_research, 5)} ${pad(v.refused_purpose, 7)} ${pad(v.limit_hit, 5)} ${pad(v.shares_created, 6)} ${pad(v.share_opens, 5)} ${pad(usd(v.spend_micro_usd), 8)}`;

console.log(`CheckCheck usage · store=${store.driver} · days are UTC\n`);
console.log(header);
for (const d of list.filter((d) => Object.values(d.values).some((n) => n > 0))) console.log(row(d.day, d.values));
console.log('-'.repeat(header.length));
console.log(row('all time', total));
console.log(`\nall time: ${total.subject_company} company checks, ${total.subject_person} person checks, ${total.checks_partial} partial, ${total.declined} called off after the question.`);
console.log('visitors = distinct addresses per day, added up across days (a returning visitor counts once per day).');
console.log('checks = research runs started · asked = a clarifying question was shown · opens = shared reports opened.');
