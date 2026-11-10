/**
 * CheckCheck public demo — HTTP server.
 *
 *   POST /api/check        one check, streamed as server-sent events (stage → result)
 *   POST /api/share        make a share link for a finished run
 *   GET  /api/shared/:id   the shared copy of a report (no login, not indexable)
 *   GET  /api/config       public limits for the page
 *
 * The OpenRouter key lives in the server environment only. Nothing here returns or logs it.
 */
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getStore } from './store';
import { admit, config, settle } from './limits';
import { bump, countVisit, logRequest } from './stats';
import { REFUSAL_COPY, screenPurpose } from './checkcheck/purposeScreen';
import { extractRequest } from './checkcheck/extract';
import { buildDetailsQuestion, classifyDetailsAnswer, needsDetailsQuestion, parseDetailsAnswer, CHECK_DECLINED_LINE } from './checkcheck/details';
import { newRunId, prepareSubject, runCheck, toSharedReport, totalCost, type CostLine, type FinishedRun, type RunLimits, type SharedReport } from './checkcheck/pipeline';
import { MODEL, OpenRouterError } from './checkcheck/openrouter';
import type { CheckSubjectInput } from './checkcheck/types';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

const ID = /^[a-f0-9]{32}$/;
const envInt = (name: string, fallback: number, min: number, max: number): number => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const runLimits = (): RunLimits => {
  const effort = (process.env.CHECKCHECK_REASONING_EFFORT ?? 'low').trim().toLowerCase();
  return {
    maxSearches: envInt('CHECKCHECK_MAX_SEARCHES', 3, 1, 5),
    maxOutputTokens: envInt('CHECKCHECK_MAX_OUTPUT_TOKENS', 8000, 2000, 16000),
    reasoningEffort: effort === 'medium' || effort === 'high' ? effort : 'low',
    timeoutMs: envInt('CHECKCHECK_TIMEOUT_MS', 150_000, 20_000, 280_000),
  };
};

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/config', (_req, res) => {
  const limits = runLimits();
  res.json({ model: MODEL, search: `Exa, up to ${limits.maxSearches} searches`, max_request_chars: config.maxRequestChars, checks_per_hour: config.checksPerIpPerHour() });
});

/** One page view of the landing page. Counted, never logged: see stats.ts. */
app.post('/api/visit', (req: Request, res: Response) => {
  void countVisit(getStore(), clientIp(req));
  res.status(204).end();
});

/** The visitor's country as the host reports it (Vercel sets x-vercel-ip-country). Never the address. */
function clientCountry(req: Request): string | null {
  const raw = String(req.headers['x-vercel-ip-country'] ?? req.headers['cf-ipcountry'] ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** The text every later step reads: the request, plus the visitor's answer to a clarifying question. */
function combinedRequest(request: string, answer: string | null): string {
  return answer ? `${request}\n\nMore about who I mean: ${answer}` : request;
}

app.post('/api/check', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { request?: unknown; answer?: unknown };
  const request = typeof body.request === 'string' ? body.request.replace(/\s+/g, ' ').trim() : '';
  const answer = typeof body.answer === 'string' && body.answer.trim() ? body.answer.replace(/\s+/g, ' ').trim() : null;
  if (request.length < 3) return res.status(400).json({ error: 'Write who you want to check.' });
  if (request.length > config.maxRequestChars || (answer !== null && answer.length > 400)) {
    return res.status(400).json({ error: `Please keep the request under ${config.maxRequestChars} characters.` });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let open = true;
  res.on('close', () => { open = false; });
  const send = (event: string, data: unknown) => {
    if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const beat = setInterval(() => { if (open) res.write(': keep-alive\n\n'); }, 10_000);
  const end = () => { clearInterval(beat); if (open) res.end(); };

  const store = getStore();
  const text = combinedRequest(request, answer);
  let reserved: number | null = null;
  const lines: CostLine[] = [];
  // For the private request log (stats.ts): how this request ended and who it was about.
  const startedAt = Date.now();
  let outcome = 'error:server';
  let loggedSubject: { name: string; type: 'person' | 'company' } | null = null;
  try {
    // 1. Purpose (no network, no cost): screening for jobs, tenancies, credit, lawsuits or private life is refused.
    const screen = screenPurpose(text);
    if (screen.refused && screen.reason) {
      send('refused', { reason: screen.reason, message: REFUSAL_COPY[screen.reason] });
      await bump(store, 'refused_purpose');
      outcome = `refused:${screen.reason}`;
      return end();
    }
    // An answer to "Which X?" that calls the check off.
    const answered = answer ? classifyDetailsAnswer(answer) : null;
    if (answered?.kind === 'declined') {
      send('declined', { message: CHECK_DECLINED_LINE });
      await bump(store, 'declined');
      outcome = 'declined';
      return end();
    }
    // 2. Limits, before anything is spent.
    const admission = await admit(store, clientIp(req));
    if (!admission.ok) {
      send('limit', { code: admission.code, message: admission.message });
      await bump(store, 'limit_hit');
      outcome = `limit:${admission.code}`;
      return end();
    }
    reserved = admission.reservedMicro;

    // 3. Who is to be checked (one small Muse Ember call; counted in the total).
    send('stage', { stage: 'reading' });
    // The starter chips end in "…": a placeholder, not part of a name.
    const extracted = await extractRequest(text.replace(/…|\.\.\./g, ' '));
    if (extracted.usage) lines.push({ step: 'extraction', cost_usd: extracted.usage.costUsd, prompt_tokens: extracted.usage.promptTokens, output_tokens: extracted.usage.outputTokens, reasoning_tokens: extracted.usage.reasoningTokens, searches: extracted.usage.searches, ms: extracted.usage.ms });
    if (!extracted.subject) {
      send('clarify', { kind: 'subject', question: extracted.problem, cost: { ...totalCost(lines), lines } });
      await bump(store, 'clarify_before_research');
      outcome = 'clarify:subject';
      return end();
    }
    let subject: CheckSubjectInput = extracted.subject;
    loggedSubject = { name: subject.name, type: subject.type };
    if (answered?.kind === 'details') {
      const d = parseDetailsAnswer(answer as string);
      subject = {
        ...subject,
        ...(!subject.website && d.website && { website: d.website }),
        ...(!subject.email && d.email && { email: d.email }),
        ...(!subject.company && subject.type === 'person' && d.company && { company: d.company }),
        ...(!subject.location && d.location && { location: d.location }),
      };
    }
    // 4. A person named with no anchor at all: one question before any research ("just run it" proceeds).
    if (!answer && needsDetailsQuestion(subject, null)) {
      send('clarify', { kind: 'details', name: subject.name, question: buildDetailsQuestion(subject.name).replace(' or email address', ', profile link or email address'), cost: { ...totalCost(lines), lines } });
      await bump(store, 'clarify_before_research');
      outcome = 'clarify:details';
      return end();
    }

    // 5. The check.
    const runId = newRunId();
    await Promise.all([bump(store, 'checks_started'), bump(store, subject.type === 'person' ? 'subject_person' : 'subject_company')]);
    const run = await runCheck({
      runId,
      subject: prepareSubject(subject),
      userRequest: text,
      limits: runLimits(),
      priorCost: lines,
      onStage: (stage) => send('stage', { stage }),
    });
    lines.length = 0;
    lines.push(...run.cost.lines);
    // Kept privately for a day so the visitor can choose to share it; never listed, never indexed.
    if (run.status === 'complete' || run.status === 'partial') await store.setJson(`run:${runId}`, run, config.runTtlSeconds).catch((err) => console.error(`[store] run save failed: ${err instanceof Error ? err.message : err}`));
    await bump(store, run.status === 'complete' ? 'checks_completed' : run.status === 'partial' ? 'checks_partial' : run.status === 'needs_clarification' ? 'clarify_from_research' : 'checks_failed');
    outcome = run.status === 'failed' ? `failed:${run.stop_reason ?? 'unknown'}` : run.status;
    send('result', { run: forVisitor(run) });
    return end();
  } catch (err: unknown) {
    const kind = err instanceof OpenRouterError ? err.kind : 'server';
    console.error(`[check] failed kind=${kind} ${err instanceof Error ? err.message.slice(0, 200) : ''}`);
    await bump(store, 'errors');
    outcome = `error:${kind}`;
    send('error', {
      message:
        kind === 'credits' ? 'This demo has run out of research credit for now. Please come back later.'
        : kind === 'timeout' ? 'The request took too long and was stopped. Please try again.'
        : 'Something went wrong on our side. Please try again.',
    });
    return end();
  } finally {
    clearInterval(beat);
    await logRequest(store, {
      at: new Date().toISOString(),
      country: clientCountry(req),
      request,
      answer,
      status: outcome,
      subject: loggedSubject?.name ?? null,
      subject_type: loggedSubject?.type ?? null,
      cost_usd: totalCost(lines).total_usd,
      ms: Date.now() - startedAt,
    });
    if (reserved !== null) {
      const total = totalCost(lines);
      // No model call was made (lines empty) → nothing was spent; otherwise the reported cost replaces the reservation.
      await settle(store, reserved, lines.length === 0 ? 0 : total.total_usd, lines.length === 0 ? true : total.complete).catch(() => undefined);
      if (total.total_usd) await bump(store, 'spend_micro_usd', Math.round(total.total_usd * 1e6));
    }
  }
});

/** What the visitor's own browser gets: everything but the stored e-mail hash. */
function forVisitor(run: FinishedRun): FinishedRun {
  const { email_hash: _hash, ...subject } = run.subject;
  return { ...run, subject };
}

function baseUrl(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

app.post('/api/share', async (req: Request, res: Response) => {
  const runId = typeof req.body?.run_id === 'string' ? req.body.run_id : '';
  if (!ID.test(runId)) return res.status(400).json({ error: 'Unknown report.' });
  const store = getStore();
  try {
    const run = await store.getJson<FinishedRun & { share_id?: string }>(`run:${runId}`);
    if (!run) return res.status(404).json({ error: 'This report is no longer available to share. Run the check again.' });
    // One link per report: a second click returns the same address.
    if (run.share_id && ID.test(run.share_id)) return res.json({ id: run.share_id, url: `${baseUrl(req)}/r/${run.share_id}` });
    const shareId = randomBytes(16).toString('hex'); // 128 bits
    const shared = toSharedReport(run, shareId);
    if (!shared) return res.status(409).json({ error: 'Only a finished report can be shared.' });
    await store.setJson(`share:${shareId}`, shared, config.shareTtlSeconds());
    await store.setJson(`run:${runId}`, { ...run, share_id: shareId }, config.runTtlSeconds);
    await bump(store, 'shares_created');
    return res.json({ id: shareId, url: `${baseUrl(req)}/r/${shareId}` });
  } catch (err: unknown) {
    console.error(`[share] failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'The link could not be created. Please try again.' });
  }
});

app.get('/api/shared/:id', async (req: Request, res: Response) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'private, no-store');
  const id = String(req.params.id);
  if (!ID.test(id)) return res.status(404).json({ error: 'Report not found.' });
  try {
    const shared = await getStore().getJson<SharedReport>(`share:${id}`);
    if (!shared) return res.status(404).json({ error: 'This report was not found or its link has expired.' });
    void bump(getStore(), 'share_opens');
    return res.json({ report: shared });
  } catch {
    return res.status(500).json({ error: 'The report could not be loaded.' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ── The built page. In development Vite serves it and proxies /api here. With `npm start` this
// server serves ./public itself. On Vercel the CDN serves ./public and vercel.json maps /r/<id> to
// index.html with the noindex header, so this block only matters off Vercel. ─────────────────────
const dist = path.resolve(process.cwd(), 'public');
if (existsSync(dist)) {
  app.get('/robots.txt', (_req, res) => {
    // Shared reports are kept out of search with a noindex header and meta tag; they must stay
    // crawlable for that instruction to be seen, so they are not disallowed here.
    res.type('text/plain').send('User-agent: *\nDisallow: /api/\n');
  });
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/r/')) res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`[checkcheck] listening on :${port} · model=${MODEL} · store=${getStore().driver} · key=${process.env.OPENROUTER_API_KEY ? 'set' : 'MISSING'}`);
  });
}

export default app;
