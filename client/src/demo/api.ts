import type { CheckRun } from '@/services/checkCheckService';

export interface CostLine {
  step: 'extraction' | 'research';
  cost_usd: number | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  searches: number | null;
  ms: number;
}
export interface Cost { total_usd: number | null; complete: boolean; lines: CostLine[] }
export interface Evidence {
  pages_cited: number;
  pages_with_excerpts: number;
  pages_read_by_app: number;
  pages_naming_subject: number;
  figures_checked: number;
  figures_removed: number;
  links_checked: number;
  links_removed: number;
  identity: 'anchored' | 'name_only' | 'unconfirmed';
  identity_note: string | null;
  checks_not_run: Array<{ check: string; why: string }>;
}
export type DemoRun = CheckRun & { cost: Cost; evidence: Evidence | null; message?: string };
export interface SharedReport {
  id: string;
  status: 'complete' | 'partial';
  subject: CheckRun['subject'];
  briefing_text: string;
  header: CheckRun['header'];
  validation: Record<string, unknown> | null;
  evidence: Evidence | null;
  completed_at: string;
  shared_at: string;
}

export type Stage = 'reading' | 'records' | 'research' | 'validating';

export type CheckEvent =
  | { type: 'stage'; stage: Stage }
  | { type: 'clarify'; kind: 'subject' | 'details'; question: string; name?: string }
  | { type: 'refused'; message: string }
  | { type: 'declined'; message: string }
  | { type: 'limit'; message: string }
  | { type: 'error'; message: string }
  | { type: 'result'; run: DemoRun };

/** One check: POST, then read the server-sent events until the stream ends. */
export async function runCheck(body: { request: string; answer?: string }, onEvent: (event: CheckEvent) => void, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch {
    onEvent({ type: 'error', message: 'Could not reach the server. Check your connection and try again.' });
    return;
  }
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    onEvent({ type: 'error', message: payload?.error ?? 'The check could not be started. Please try again.' });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const handle = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length === 0) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(data.join('\n')) as Record<string, unknown>; } catch { return; }
    if (event !== 'stage') finished = true;
    onEvent({ type: event, ...payload } as CheckEvent);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at = buffer.indexOf('\n\n');
      while (at >= 0) {
        handle(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
        at = buffer.indexOf('\n\n');
      }
    }
  } catch {
    /* handled below */
  }
  if (!finished) onEvent({ type: 'error', message: 'The connection was lost before the check finished. Please try again.' });
}

export async function createShareLink(runId: string): Promise<{ id: string; url: string }> {
  const response = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: runId }) });
  const payload = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: string } | null;
  if (!response.ok || !payload?.url || !payload.id) throw new Error(payload?.error ?? 'The link could not be created.');
  return { id: payload.id, url: payload.url };
}

export async function getSharedReport(id: string): Promise<SharedReport> {
  const response = await fetch(`/api/shared/${encodeURIComponent(id)}`);
  const payload = (await response.json().catch(() => null)) as { report?: SharedReport; error?: string } | null;
  if (!response.ok || !payload?.report) throw new Error(payload?.error ?? 'This report was not found.');
  return payload.report;
}

export function emailDraftHref(subjectName: string, url: string): string {
  const subject = `CheckCheck report: ${subjectName}`;
  const body = `Here is a CheckCheck report on ${subjectName}:\n\n${url}\n\nIt was put together from public sources by CheckCheck by Jinna. Anyone with this link can open it.`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
