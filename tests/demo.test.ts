/**
 * Tests for the parts written for this standalone demo. No network, no model, no key needed.
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { citationsToChips, prepareSubject, sanitizeBriefingForShare, stripPreamble, totalCost } from '../server/checkcheck/pipeline';
import { anchorsInText, occursIn } from '../server/checkcheck/extract';
import { screenPurpose } from '../server/checkcheck/purposeScreen';
import { classifyDetailsAnswer, clarificationOf, needsDetailsQuestion } from '../server/checkcheck/details';
import { toGrounding } from '../server/checkcheck/openrouter';

const REPORT = [
  '## Profile',
  'Name: Acme Roofing Ltd',
  'Location: Leeds, United Kingdom',
  '',
  '## In brief',
  'Acme Roofing is a roofing contractor founded in 2011 [Acme](https://acme.example/about). You should ask about the deposit.',
  '',
  '## For your situation',
  'You said they want half the money up front for your roof.',
  '',
  '**Sources checked on 1 Jan 2026**',
  '- [acme.example](https://acme.example/about) (search result)',
].join('\n');

test('preamble glued to the first heading is removed and the heading survives', () => {
  const out = stripPreamble("Checking Acme for your roof job — gathering details.## Profile\nName: Acme\n\n## In brief\nText.");
  assert.ok(out.startsWith('## Profile'));
  assert.ok(!out.includes('your roof job'));
  assert.ok(out.includes('## In brief'));
});

test('shared copy drops the private section, second-person sentences and echoes of the request', () => {
  const request = 'Acme Roofing Ltd quoted for my roof and they want half the money up front before any work starts';
  const withEcho = REPORT.replace('founded in 2011', 'founded in 2011 and they want half the money up front');
  const { text } = sanitizeBriefingForShare(withEcho, request, 'Acme Roofing Ltd');
  assert.ok(!text.includes('For your situation'));
  assert.ok(!/\byou\b/i.test(text));
  assert.ok(!text.includes('half the money up front'));
  assert.ok(text.includes('## Profile') && text.includes('Name: Acme Roofing Ltd'));
  assert.ok(text.includes('Sources checked'));
});

test('a sentence that only repeats the subject name is not treated as an echo of the request', () => {
  const { text } = sanitizeBriefingForShare('## In brief\nJohn Albert Maximilian Smith Jones is a director.', 'check John Albert Maximilian Smith Jones please', 'John Albert Maximilian Smith Jones');
  assert.ok(text.includes('is a director'));
});

test('sentence-end citations of returned pages become source chips; other links are left alone', () => {
  const retrieved = new Map([['a', { url: 'https://news.example/story' }], ['b', { url: 'https://acme.example/' }]]);
  const text = '## Profile\nLinks: [Acme](https://acme.example/)\n\n## In brief\nAcme grew fast [Example News](https://news.example/story). Its site says so [Acme](https://acme.example/). See [Other](https://unknown.example/x).';
  const out = citationsToChips(text, retrieved, 'Acme');
  assert.ok(out.includes('[Example News](https://news.example/story "source")'));
  assert.ok(out.includes('[acme.example](https://acme.example/ "source")'), 'a citation named after the subject is renamed to its site');
  assert.ok(out.includes('Links: [Acme](https://acme.example/)'), 'Profile lines are untouched');
  assert.ok(out.includes('[Other](https://unknown.example/x)'), 'a link the search did not return is not presented as a source');
});

test('anchors are read from the text by the app, never invented', () => {
  const a = anchorsInText('Check Jane Doe, jane@acme-design.co.uk, https://www.linkedin.com/in/janedoe and acme-design.co.uk e.g. soon');
  assert.equal(a.email, 'jane@acme-design.co.uk');
  assert.equal(a.profile_url, 'https://www.linkedin.com/in/janedoe');
  assert.equal(a.website, 'https://acme-design.co.uk/');
  assert.ok(occursIn('Jane Doe', 'please check jane doe from Leeds'));
  assert.ok(!occursIn('Jane Smith', 'please check jane doe from Leeds'));
});

test('an e-mail address is reduced to a hash and a business domain becomes the website anchor', () => {
  const s = prepareSubject({ name: 'Jane Doe', type: 'person', email: 'Jane@Acme-Design.co.uk' });
  assert.equal((s as { email?: string }).email, undefined);
  assert.match(s.email_hash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(s.website, 'https://acme-design.co.uk');
  assert.equal(prepareSubject({ name: 'J', type: 'person', email: 'j@gmail.com' }).website, undefined);
});

test('purpose restrictions and the bare-name question are preserved', () => {
  assert.equal(screenPurpose('background check on a nanny I want to hire').refused, true);
  assert.equal(screenPurpose('I am meeting an investor next week, help me prepare').refused, false);
  assert.equal(needsDetailsQuestion({ type: 'person' }, null), true);
  assert.equal(needsDetailsQuestion({ type: 'person', company: 'Acme' }, null), false);
  assert.equal(needsDetailsQuestion({ type: 'company' }, null), false);
  assert.deepEqual(classifyDetailsAnswer('just run it'), { kind: 'run' });
  assert.deepEqual(classifyDetailsAnswer('never mind'), { kind: 'declined' });
  assert.equal(clarificationOf('Which Acme Design LLC do you mean? A state or website would settle it.') !== null, true);
  assert.equal(clarificationOf('## Profile\nName: Acme'), null);
});

test('cost is summed from reported costs and marked incomplete when a call reported none', () => {
  const line = { step: 'research' as const, prompt_tokens: 1, output_tokens: 1, reasoning_tokens: 0, searches: 3, ms: 10 };
  assert.deepEqual(totalCost([{ ...line, cost_usd: 0.02 }, { ...line, step: 'extraction', cost_usd: 0.0002 }]), { total_usd: 0.0202, complete: true });
  assert.deepEqual(totalCost([{ ...line, cost_usd: 0.02 }, { ...line, cost_usd: null }]), { total_usd: 0.02, complete: false });
  assert.deepEqual(totalCost([{ ...line, cost_usd: null }]), { total_usd: null, complete: false });
});

test('citation annotations map to retrieved pages and excerpts; nothing is invented for missing metadata', () => {
  const g = toGrounding({
    text: 'x', model: 'meta/muse-ember', finishReason: 'stop',
    annotations: [{ url: 'https://a.example/1', title: 'A', content: 'excerpt' }, { url: 'https://b.example/2', title: null, content: '' }],
    usage: { promptTokens: 10, outputTokens: 5, reasoningTokens: 1, searches: 2, costUsd: 0.01, ms: 5 },
  });
  assert.equal(g.chunks.length, 2);
  assert.equal(g.excerpts.size, 1);
  assert.deepEqual(g.supports, []);
  assert.deepEqual(g.searchQueries, []);
  assert.equal(g.finishReason, 'STOP');
  assert.equal(toGrounding({ text: '', model: 'meta/muse-ember', finishReason: 'length', annotations: [], usage: { promptTokens: null, outputTokens: null, reasoningTokens: null, searches: null, costUsd: null, ms: 1 } }).finishReason, 'length');
});
