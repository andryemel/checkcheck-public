/**
 * The only place this app talks to a model: OpenRouter chat completions, model `meta/muse-ember`.
 *
 * Rules of this file:
 *   - ONE model. There is no fallback model and no retry; if the answering model is not Muse Ember
 *     the call is treated as failed (no silent substitution).
 *   - The API key is read from the server environment and never logged or returned.
 *   - Every call returns the cost OpenRouter reported for it (`usage.cost`), or null when the
 *     response carried none — the caller shows "unavailable", never zero.
 */
import type { GroundedDetailedResult } from './grounding';

export const MODEL = 'meta/muse-ember';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
  constructor(
    public readonly kind: 'no_key' | 'timeout' | 'http' | 'wrong_model' | 'bad_response' | 'context_too_long' | 'credits',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export interface CallUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  searches: number | null;
  costUsd: number | null;
  ms: number;
}

interface RawAnnotation {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string; start_index?: number; end_index?: number };
}

interface RawResponse {
  model?: string;
  error?: { message?: string; code?: number | string };
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: { content?: string | null; annotations?: RawAnnotation[] };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    server_tool_use_details?: { web_search_requests?: number };
  };
}

export interface ChatInput {
  system?: string;
  user: string;
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs: number;
  /** Web search through OpenRouter's server tool, Exa engine, hard-capped. Omit for a plain call. */
  search?: { maxSearches: number; maxResults: number };
  /** Ask for a JSON object that follows this schema (structured outputs). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export interface ChatResult {
  text: string;
  model: string;
  finishReason: string | null;
  annotations: Array<{ url: string; title: string | null; content: string }>;
  usage: CallUsage;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function chat(input: ChatInput, fetchImpl: typeof fetch = fetch): Promise<ChatResult> {
  const key = (process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!key) throw new OpenRouterError('no_key', 'OPENROUTER_API_KEY is not set on the server.');

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      { role: 'user', content: input.user },
    ],
    max_tokens: input.maxOutputTokens,
    temperature: input.temperature ?? 0.2,
    reasoning: { effort: input.reasoningEffort ?? 'low' },
    usage: { include: true },
  };
  if (input.search) {
    body.tools = [
      {
        type: 'openrouter:web_search',
        parameters: { engine: 'exa', max_uses: input.search.maxSearches, max_results: input.search.maxResults },
      },
    ];
  }
  if (input.jsonSchema) {
    body.response_format = { type: 'json_schema', json_schema: { name: input.jsonSchema.name, strict: true, schema: input.jsonSchema.schema } };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  let raw: string;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'CheckCheck by Jinna',
      },
      body: JSON.stringify(body),
    });
    raw = await response.text();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OpenRouterError('timeout', `The model did not answer within ${Math.round(input.timeoutMs / 1000)} seconds.`);
    }
    throw new OpenRouterError('http', `Could not reach OpenRouter: ${err instanceof Error ? err.message : 'network error'}`);
  } finally {
    clearTimeout(timer);
  }

  let parsed: RawResponse | null = null;
  try {
    parsed = JSON.parse(raw) as RawResponse;
  } catch {
    parsed = null;
  }
  if (!response.ok || !parsed || parsed.error) {
    // The provider's message never contains our key, but scrub it anyway before it can reach a log.
    const message = String(parsed?.error?.message ?? raw.slice(0, 300)).split(key).join('<key>');
    if (response.status === 402) throw new OpenRouterError('credits', 'OpenRouter refused the request: no credits available for this configuration.', 402);
    if (/context|too long|maximum.*tokens|token limit/i.test(message)) throw new OpenRouterError('context_too_long', `The request was too long for the model: ${message}`, response.status);
    throw new OpenRouterError('http', `OpenRouter answered ${response.status}: ${message}`, response.status);
  }
  const model = String(parsed.model ?? '');
  if (!model.startsWith(MODEL)) {
    throw new OpenRouterError('wrong_model', `Expected ${MODEL}, but "${model || 'unknown'}" answered. The result was discarded.`);
  }
  const choice = parsed.choices?.[0];
  if (!choice) throw new OpenRouterError('bad_response', 'OpenRouter returned no answer.');

  const seen = new Set<string>();
  const annotations: ChatResult['annotations'] = [];
  for (const a of choice.message?.annotations ?? []) {
    const url = a?.url_citation?.url;
    if (a?.type !== 'url_citation' || typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    annotations.push({
      url,
      title: typeof a.url_citation?.title === 'string' && a.url_citation.title.trim() ? a.url_citation.title.trim() : null,
      content: typeof a.url_citation?.content === 'string' ? a.url_citation.content : '',
    });
  }
  return {
    text: typeof choice.message?.content === 'string' ? choice.message.content : '',
    model,
    finishReason: choice.finish_reason ?? choice.native_finish_reason ?? null,
    annotations,
    usage: {
      promptTokens: num(parsed.usage?.prompt_tokens),
      outputTokens: num(parsed.usage?.completion_tokens),
      reasoningTokens: num(parsed.usage?.completion_tokens_details?.reasoning_tokens),
      searches: num(parsed.usage?.server_tool_use_details?.web_search_requests),
      costUsd: num(parsed.usage?.cost),
      ms: Date.now() - started,
    },
  };
}

/** A searched answer in the shape the validation pipeline reads (grounding.ts). */
export function toGrounding(result: ChatResult): GroundedDetailedResult {
  const excerpts = new Map<string, string>();
  for (const a of result.annotations) if (a.content.trim()) excerpts.set(a.url, a.content);
  return {
    text: result.text,
    model: result.model,
    // OpenRouter reports "stop" / "length"; the pipeline's cut-short test is "anything but STOP".
    finishReason: result.finishReason === 'stop' ? 'STOP' : result.finishReason,
    grounded: result.annotations.length > 0,
    chunks: result.annotations.map((a, index) => ({ index, uri: a.url, title: a.title })),
    supports: [],
    urlContext: [],
    searchQueries: [],
    excerpts,
    usage: {
      promptTokens: result.usage.promptTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.promptTokens !== null && result.usage.outputTokens !== null ? result.usage.promptTokens + result.usage.outputTokens : null,
      reasoningTokens: result.usage.reasoningTokens,
      searches: result.usage.searches,
      costUsd: result.usage.costUsd,
    },
  };
}
