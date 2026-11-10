import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublic, isPublicAddress, publicUrl, type Resolver } from '../server/checkcheck/netGuard';
import { parseDetailsAnswer } from '../server/checkcheck/details';

const resolveTo = (map: Record<string, string[]>): Resolver => async (host) => {
  const found = map[host];
  if (!found) throw new Error('ENOTFOUND');
  return found;
};

test('net guard: private, loopback, link-local and reserved addresses are not public', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('net guard: only ordinary web addresses that resolve to the public internet may be fetched', async () => {
  const resolve = resolveTo({ 'acme.example': ['93.184.216.34'], 'inside.example': ['10.0.0.5'], 'mixed.example': ['93.184.216.34', '127.0.0.1'] });
  assert.ok(await publicUrl('https://acme.example/about', resolve));
  for (const bad of [
    'http://127.0.0.1/', 'http://127.0.0.1:9001/x', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/', 'http://0x7f.1/', 'file:///etc/passwd', 'ftp://acme.example/', 'https://user:pass@acme.example/', 'https://acme.example:8443/',
    'https://inside.example/', 'https://mixed.example/', 'https://unknown.example/', 'https://intranet/', 'https://db.internal/', 'not a url',
  ]) {
    assert.equal(await publicUrl(bad, resolve), null, bad);
  }
});

test('net guard: a redirect to a private address is not followed', async () => {
  const resolve = resolveTo({ 'acme.example': ['93.184.216.34'], 'www.acme.example': ['93.184.216.34'] });
  const calls: string[] = [];
  const fake = (async (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://acme.example/') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9001/secret' } });
    if (url === 'https://acme.example/moved') return new Response(null, { status: 301, headers: { location: 'https://www.acme.example/' } });
    return new Response('<html>ok</html>', { status: 200 });
  }) as typeof fetch;
  assert.equal(await fetchPublic('https://acme.example/', {}, resolve, fake), null);
  assert.deepEqual(calls, ['https://acme.example/'], 'the private address was never requested');
  const ok = await fetchPublic('https://acme.example/moved', {}, resolve, fake);
  assert.equal(ok?.status, 200, 'a redirect to another public address is followed');
});

test('details answer: an address made of numbers is not taken as a website', () => {
  assert.equal(parseDetailsAnswer('http://127.0.0.1:9001/x').website, undefined);
  assert.equal(parseDetailsAnswer('it is 10.0.0.5').website, undefined);
  assert.equal(parseDetailsAnswer('acme-design.co.uk').website, 'https://acme-design.co.uk');
});
