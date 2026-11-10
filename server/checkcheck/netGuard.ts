/**
 * The app reads pages whose addresses come from outside: a website a visitor typed, a page the
 * search cited. Those addresses must only ever lead to the public internet — never to this
 * server itself, its host's internal network or a private range.
 *
 *   - http and https only, default ports only, no user:password in the address
 *   - the host name is resolved first and EVERY address it resolves to must be public
 *   - redirects are followed by hand, and each hop is checked the same way
 *
 * What this does not close: a name that resolves to a public address for the check and to a
 * private one a moment later for the request itself (DNS rebinding). The time window is
 * milliseconds and the response is only ever read as page text.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 4;

function isPublicV4(ip: string): boolean {
  const p = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // protocol assignments + documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** True only for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family !== 6) return false;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (mapped) return isPublicV4(mapped);
  if (lower === '::' || lower === '::1') return false; // unspecified, loopback
  if (/^::ffff:/.test(lower)) return false; // any other mapped form
  if (/^f[cd]/.test(lower)) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return false; // link-local fe80::/10
  if (/^ff/.test(lower)) return false; // multicast
  if (/^64:ff9b:/.test(lower)) return false; // NAT64 (wraps an IPv4 address)
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;

const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** The address as a URL when it may be fetched, or null. */
export async function publicUrl(raw: string, resolve: Resolver = dnsResolver): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return null;
  if (isIP(host)) return isPublicAddress(host) ? url : null;
  if (host === 'localhost' || !host.includes('.') || /\.(?:localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return null;
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) return null;
  return url;
}

/**
 * `fetch` for an address that came from outside. Returns null when the address, or any redirect
 * on the way, does not lead to the public internet. Network errors and timeouts throw, as fetch does.
 */
export async function fetchPublic(raw: string, init: RequestInit = {}, resolve: Resolver = dnsResolver, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  let next = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await publicUrl(next, resolve);
    if (!url) return null;
    const response = await fetchImpl(url, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    try {
      next = new URL(location, url).toString();
    } catch {
      return null;
    }
  }
  return null; // too many redirects
}
