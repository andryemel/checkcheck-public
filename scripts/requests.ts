/**
 * The private request log, newest first. Nothing here is served over HTTP.
 *
 *   STORE_DRIVER=redis npx tsx --env-file=.env.local scripts/requests.ts [count=30] [--json]
 */
import { getStore } from '../server/store';
import { readRequestLog } from '../server/stats';

const count = Math.min(5000, Math.max(1, Number.parseInt(process.argv.find((a) => /^\d+$/.test(a)) ?? '30', 10)));
const store = getStore();
const entries = await readRequestLog(store, count);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(entries, null, 1));
} else {
  console.log(`CheckCheck requests · store=${store.driver} · newest first · times are UTC · ${entries.length} shown\n`);
  for (const e of entries) {
    const when = e.at.replace('T', ' ').slice(0, 16);
    const cost = e.cost_usd === null ? '' : ` · $${e.cost_usd.toFixed(4)}`;
    const subject = e.subject ? ` · ${e.subject_type}: ${e.subject}` : '';
    console.log(`${when}  ${e.country ?? '??'}  ${e.status}${subject}${cost} · ${Math.round(e.ms / 100) / 10}s`);
    console.log(`    ${e.request}`);
    if (e.answer) console.log(`    answer: ${e.answer}`);
  }
  if (entries.length === 0) console.log('(no requests logged yet)');
}
