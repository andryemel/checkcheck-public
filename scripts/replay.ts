/**
 * Development tool: run the validation pipeline again on a saved model answer (no model call, no cost).
 * Answers are saved when the server runs with CHECKCHECK_DEBUG_DIR set.
 *
 *   npx tsx scripts/replay.ts data/debug/answer-<run id>.json [--shared] [--store]
 *
 *   --shared  also print the copy a share link would show
 *   --store   save that copy in the local file store and print its /r/<id> path, to look at it in the browser
 */
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { runCheck, sanitizeBriefingForShare, toSharedReport } from '../server/checkcheck/pipeline';
import { getStore } from '../server/store';

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/replay.ts <saved answer .json>');
  process.exit(2);
}
const saved = JSON.parse(await readFile(file, 'utf8'));
const run = await runCheck({
  runId: 'replay',
  subject: saved.subject,
  userRequest: saved.userRequest,
  limits: { maxSearches: 3, maxOutputTokens: 8000, reasoningEffort: 'low', timeoutMs: 1000 },
  priorCost: [],
  replay: saved.result,
});
console.log(`status=${run.status} evidence=${JSON.stringify({ ...run.evidence, checks_not_run: run.evidence?.checks_not_run.length })}`);
console.log('──────── report ────────');
console.log(run.briefing_text);
if (run.briefing_text && process.argv.includes('--shared')) {
  const shared = sanitizeBriefingForShare(run.briefing_text, saved.userRequest, saved.subject.name);
  console.log(`──────── shared copy (removed ${shared.removed}) ────────`);
  console.log(shared.text);
}
if (process.argv.includes('--store')) {
  const id = randomBytes(16).toString('hex');
  const shared = toSharedReport(run, id);
  if (shared) {
    await getStore().setJson(`share:${id}`, shared, 86_400);
    console.log(`stored: /r/${id}`);
  }
}
