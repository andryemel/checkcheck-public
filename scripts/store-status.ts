/**
 * Today's counters in the configured store, and optionally whether given records exist.
 *   STORE_DRIVER=redis npx tsx --env-file=.env.local scripts/store-status.ts [key …]
 */
import { getStore } from '../server/store';

const store = getStore();
const day = new Date().toISOString().slice(0, 10);
const checks = await store.incrBy(`checks:${day}`, 0, 90_000);
const spend = (await store.incrBy(`spend:${day}`, 0, 90_000)) / 1e6;
console.log(`driver=${store.driver} day=${day} checks=${checks} spend_usd=${spend}`);
for (const key of process.argv.slice(2)) console.log(`${key.split(':')[0]} record present: ${(await store.getJson(key)) !== null}`);
