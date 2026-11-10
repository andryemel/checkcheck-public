/**
 * Persistence for the public demo: finished runs, shared reports, and the counters behind the
 * request and spending caps.
 *
 * Two drivers behind one interface:
 *   file   local development. JSON files under ./data, counters guarded by an in-process queue.
 *          Correct for ONE server process only.
 *   redis  any Upstash-compatible Redis REST API. Counters use INCRBY, which is atomic on the
 *          server, so the caps hold under concurrent requests and across serverless instances.
 *
 * Counters are integers (micro-dollars for money) because INCRBY is exact and INCRBYFLOAT is not.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface Store {
  readonly driver: 'file' | 'redis';
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Atomically add `by` (may be negative) and return the new value. A new key expires after `ttlSeconds`. */
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
}

const safeName = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 40);

class FileStore implements Store {
  readonly driver = 'file' as const;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    return path.join(this.dir, `${key.split(':')[0].replace(/[^a-z]/g, '')}-${safeName(key)}.json`);
  }
  private async read<T>(key: string): Promise<{ value: T; expires_at: number | null } | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(key), 'utf8')) as { value: T; expires_at: number | null };
      if (parsed.expires_at !== null && parsed.expires_at < Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  private async write(key: string, value: unknown, expiresAt: number | null): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(key);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ value, expires_at: expiresAt }));
    await rename(tmp, target);
  }
  async getJson<T>(key: string): Promise<T | null> {
    return (await this.read<T>(key))?.value ?? null;
  }
  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.write(key, value, ttlSeconds ? Date.now() + ttlSeconds * 1000 : null);
  }
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    // One at a time: read-modify-write is only safe because every increment of this process passes through this queue.
    const next = this.queue.then(async () => {
      const current = await this.read<number>(key);
      const value = (current?.value ?? 0) + by;
      await this.write(key, value, current?.expires_at ?? Date.now() + ttlSeconds * 1000);
      return value;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

class RedisRestStore implements Store {
  readonly driver = 'redis' as const;
  constructor(private readonly url: string, private readonly token: string) {}

  private async command<T>(args: Array<string | number>): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = (await response.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!response.ok || !body || body.error) throw new Error(`store command ${String(args[0])} failed (${response.status})`);
    return body.result as T;
  }
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.command<string | null>(['GET', key]);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const args: Array<string | number> = ['SET', key, JSON.stringify(value)];
    if (ttlSeconds) args.push('EX', ttlSeconds);
    await this.command(args);
  }
  async incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    const value = await this.command<number>(['INCRBY', key, Math.round(by)]);
    // NX: only a key without an expiry gets one, so the window is set once by whoever created it.
    await this.command(['EXPIRE', key, ttlSeconds, 'NX']).catch(() => undefined);
    return Number(value);
  }
}

let singleton: Store | null = null;

export function getStore(): Store {
  if (singleton) return singleton;
  const driver = (process.env.STORE_DRIVER ?? 'file').trim().toLowerCase();
  if (driver === 'redis') {
    const url = (process.env.UPSTASH_REDIS_REST_URL ?? '').trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();
    if (!url || !token) throw new Error('STORE_DRIVER=redis needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    singleton = new RedisRestStore(url, token);
  } else {
    singleton = new FileStore(path.resolve(process.cwd(), 'data'));
  }
  return singleton;
}
