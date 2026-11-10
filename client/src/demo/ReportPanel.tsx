import { useState } from 'react';
import { Check, Copy, Link2, Mail, RotateCcw } from 'lucide-react';
import { CheckBriefingView } from '@/components/checkcheck/CheckBriefingView';
import { SETTINGS_SECTION_CLASS, SETTINGS_SECTION_TITLE_CLASS } from '@/components/company/settingsSection';
import { TODO_CARD_SURFACE_CLASS } from '@/components/todo/todoCardSurface';
import { cn } from '@/lib/utils';
import type { CheckRun } from '@/services/checkCheckService';
import { createShareLink, emailDraftHref, type Cost, type Evidence } from './api';

const PILL = 'flex h-10 items-center gap-2 rounded-full border border-[#F0F0F0] bg-white px-4 font-inter text-[13px] font-medium text-black transition-colors hover:bg-[#FAFAFA] disabled:opacity-50 sm:h-9';
const PILL_DARK = 'flex h-10 items-center gap-2 rounded-full bg-black px-4 font-inter text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 sm:h-9';

function money(v: number): string {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`;
}

/** The real OpenRouter cost of this check: every model call, as reported, never estimated. */
export function CostLine({ cost }: { cost: Cost }) {
  const research = cost.lines.find((l) => l.step === 'research');
  const seconds = Math.round(cost.lines.reduce((sum, l) => sum + l.ms, 0) / 1000);
  const parts: string[] = [];
  if (cost.total_usd !== null) {
    parts.push(`This check cost ${money(cost.total_usd)}${cost.complete ? '' : ' (one call reported no cost)'}`);
    if (cost.complete && cost.total_usd > 0) parts.push(`about ${Math.floor(1 / cost.total_usd)} checks per $1`);
  } else {
    parts.push('Cost unavailable: OpenRouter reported none for this check');
  }
  if (research?.searches != null) parts.push(`${research.searches} ${research.searches === 1 ? 'search' : 'searches'}`);
  parts.push(`${seconds} s of model time`);
  return (
    <p className="font-inter text-xs text-[#858481]" data-testid="cost-line">
      {parts.join(' · ')} · meta/muse-ember via OpenRouter
    </p>
  );
}

/** What the evidence does and does not establish. Shown with every report, own and shared. */
export function EvidenceNotes({ evidence }: { evidence: Evidence }) {
  return (
    <section className={cn(SETTINGS_SECTION_CLASS, 'space-y-4')} data-testid="evidence-notes">
      <h3 className={SETTINGS_SECTION_TITLE_CLASS}>How far the evidence goes</h3>
      <div className={cn(TODO_CARD_SURFACE_CLASS, 'space-y-3 px-5 py-4 text-sm leading-relaxed text-gray-800 sm:px-[30px] sm:py-6')}>
        {evidence.identity_note && (
          <p className="rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900" data-testid="identity-note">
            <span className="font-semibold">Identity not confirmed. </span>
            {evidence.identity_note}
          </p>
        )}
        <p>
          The search returned {evidence.pages_cited} {evidence.pages_cited === 1 ? 'page' : 'pages'}, and this app could open and read {evidence.pages_read_by_app} {evidence.pages_read_by_app === 1 ? 'page' : 'pages'} itself (search results and the subject’s own site). {evidence.pages_naming_subject} of the pages it holds mention the subject by name.
        </p>
        <p>
          {evidence.links_checked} {evidence.links_checked === 1 ? 'link' : 'links'} in the report {evidence.links_checked === 1 ? 'was' : 'were'} compared with what the search returned{evidence.links_removed > 0 ? `, and ${evidence.links_removed} that did not match ${evidence.links_removed === 1 ? 'was' : 'were'} removed` : ''}. {evidence.figures_checked} {evidence.figures_checked === 1 ? 'sentence with a figure was' : 'sentences with figures were'} compared with the text of the cited page{evidence.figures_removed > 0 ? `, and ${evidence.figures_removed} ${evidence.figures_removed === 1 ? 'was' : 'were'} removed because the figure was not there` : ''}.
        </p>
        <p className="text-[13px] text-gray-600">
          A source shown under a section is a page the model cited and the search really returned. That is not the same as an independent check of every sentence: read the source before you rely on a claim.
        </p>
        <details className="text-[13px] text-gray-600">
          <summary className="cursor-pointer select-none font-medium text-gray-800">Checks that did not run ({evidence.checks_not_run.length})</summary>
          <ul className="mt-2 space-y-2">
            {evidence.checks_not_run.map((c) => (
              <li key={c.check}>
                <span className="font-medium text-gray-800">{c.check}: </span>
                {c.why}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

export function ReportPanel({ run, cost, evidence, onAgain }: { run: CheckRun; cost: Cost; evidence: Evidence | null; onAgain: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | 'share' | 'email'>(null);
  const [copied, setCopied] = useState(false);
  const name = run.subject.name;

  const make = async (): Promise<string | null> => {
    if (link) return link;
    setBusy(true);
    setError(null);
    try {
      const created = await createShareLink(run.id);
      setLink(created.url);
      return created.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The link could not be created.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the address is on screen to copy by hand */
    }
  };
  const confirm = async () => {
    const mode = confirming;
    const url = await make();
    if (!url) return;
    setConfirming(null);
    if (mode === 'email') window.location.href = emailDraftHref(name, url);
    else void copy(url);
  };

  return (
    <div className="w-full space-y-6" data-testid="report-panel">
      <CheckBriefingView run={run} editable={false} offerContact={false} hideContactPill />
      {evidence && <EvidenceNotes evidence={evidence} />}
      <div className="space-y-3 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PILL_DARK} disabled={busy} onClick={() => (link ? void copy(link) : setConfirming('share'))} data-testid="share-button">
            <Link2 className="h-4 w-4" aria-hidden />
            {link ? (copied ? 'Link copied' : 'Copy share link') : 'Share report'}
          </button>
          {link ? (
            <a className={cn(PILL, 'no-underline')} href={emailDraftHref(name, link)} data-testid="email-link">
              <Mail className="h-4 w-4" aria-hidden />
              Email report
            </a>
          ) : (
            <button type="button" className={PILL} disabled={busy} onClick={() => setConfirming('email')} data-testid="email-button">
              <Mail className="h-4 w-4" aria-hidden />
              Email report
            </button>
          )}
          <button type="button" className={PILL} onClick={onAgain} data-testid="again-button">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Run another check
          </button>
        </div>
        {confirming && !link && (
          <div className="rounded-2xl border border-[#E0E0E0] bg-white p-4 text-sm text-gray-800" data-testid="share-confirm">
            <p className="font-medium text-black">Create a public link to this report?</p>
            <p className="mt-1 text-[13px] text-gray-600">
              Anyone with the link can view the report, without signing in. Your request and the “For your situation” section are left out, and so is any sentence addressed to you. The link is not listed anywhere and search engines are asked not to index it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={PILL_DARK} disabled={busy} onClick={() => void confirm()} data-testid="share-confirm-yes">
                {busy ? 'Creating…' : confirming === 'email' ? 'Create link and open email' : 'Create link'}
              </button>
              <button type="button" className={PILL} disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        )}
        {link && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E0E0E0] bg-white p-3" data-testid="share-link-row">
            <a href={link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-inter text-[13px] text-black underline decoration-dotted underline-offset-2" data-testid="share-link">{link}</a>
            <button type="button" className={PILL} onClick={() => void copy(link)}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <p className="w-full text-xs text-[#858481]">Anyone with this link can view the report.</p>
          </div>
        )}
        {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}
        <CostLine cost={cost} />
      </div>
    </div>
  );
}
