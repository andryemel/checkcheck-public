import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, Handshake, Search, TrendingUp } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import jinnaSphere from '@/assets/jinna-sphere.png';
import { cn } from '@/lib/utils';
import { runCheck, type CheckEvent, type DemoRun, type Stage } from '@/demo/api';
import { ReportPanel } from '@/demo/ReportPanel';
import { Shell } from '@/demo/Shell';

const MAX_TEXT_LENGTH = 1000;

/** A chip fills the box with an editable starter and puts the cursor at its end; it never runs a check. */
const CHIPS: Array<{ label: string; starter: string; icon: typeof Search }> = [
  { label: 'Meet an investor', starter: 'I’m meeting an investor. Help me prepare. Their name or profile is…', icon: TrendingUp },
  { label: 'Check a client', starter: 'I’m considering working with a new client. Check their business and background: …', icon: Briefcase },
  { label: 'Check a co-founder', starter: 'I’m considering a potential co-founder. Check their professional background: …', icon: Handshake },
];

const STAGE_COPY: Record<Stage, string> = {
  reading: 'Reading your request',
  records: 'Checking registers and the website',
  research: 'Searching and reading sources',
  validating: 'Checking links and figures',
};
const STAGE_ORDER: Stage[] = ['reading', 'records', 'research', 'validating'];

type View =
  | { kind: 'idle' }
  | { kind: 'running'; stage: Stage }
  | { kind: 'clarify'; question: string; mode: 'subject' | 'details' | 'research' }
  | { kind: 'notice'; tone: 'refused' | 'limit' | 'error' | 'declined'; message: string }
  | { kind: 'result'; run: DemoRun };

const SPHERE_SPIN = { rotate: 360, scale: [1, 1.05, 0.95, 1.05, 0.95, 0.9, 0.95, 1] };

function Sphere({ size, fast = false }: { size: number; fast?: boolean }) {
  return (
    <motion.img
      src={jinnaSphere}
      alt=""
      aria-hidden
      className="mx-auto select-none"
      style={{ width: size, height: size }}
      animate={SPHERE_SPIN}
      transition={{
        rotate: { repeat: Infinity, duration: fast ? 12 : 160, ease: 'linear' },
        scale: { repeat: Infinity, duration: fast ? 6 : 35, ease: 'easeInOut' },
      }}
    />
  );
}

export default function HomePage() {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  /** The request a clarifying question belongs to: the answer is sent together with it. */
  const pendingRequest = useRef('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    // One page view per browser tab, for the private usage count (a number only; nothing about the visitor is stored).
    try {
      if (sessionStorage.getItem('cc-visit')) return;
      sessionStorage.setItem('cc-visit', '1');
    } catch {
      /* private mode: count the view anyway */
    }
    void fetch('/api/visit', { method: 'POST', keepalive: true }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (view.kind === 'clarify') answerRef.current?.focus();
  }, [view.kind]);

  const start = useCallback(async (request: string, clarifying?: string) => {
    pendingRequest.current = request;
    setView({ kind: 'running', stage: 'reading' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const controller = new AbortController();
    abortRef.current = controller;
    const onEvent = (event: CheckEvent) => {
      if (event.type === 'stage') setView({ kind: 'running', stage: event.stage });
      else if (event.type === 'clarify') setView({ kind: 'clarify', question: event.question, mode: event.kind });
      else if (event.type === 'refused') setView({ kind: 'notice', tone: 'refused', message: event.message });
      else if (event.type === 'declined') setView({ kind: 'notice', tone: 'declined', message: event.message });
      else if (event.type === 'limit') setView({ kind: 'notice', tone: 'limit', message: event.message });
      else if (event.type === 'error') setView({ kind: 'notice', tone: 'error', message: event.message });
      else if (event.type === 'result') {
        const run = event.run;
        if (run.status === 'needs_clarification' && run.briefing_text) setView({ kind: 'clarify', question: run.briefing_text, mode: 'research' });
        else if (run.status === 'failed') setView({ kind: 'notice', tone: 'error', message: run.message ?? 'The research could not be completed. Please try again.' });
        else setView({ kind: 'result', run });
      }
    };
    await runCheck(clarifying ? { request, answer: clarifying } : { request }, onEvent, controller.signal);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const request = text.trim();
    if (request.length < 3 || view.kind === 'running') return;
    setAnswer('');
    void start(request);
  };
  const submitAnswer = (e: FormEvent) => {
    e.preventDefault();
    const value = answer.trim();
    if (!value) return;
    void start(pendingRequest.current, value);
  };
  const reset = () => {
    abortRef.current?.abort();
    setView({ kind: 'idle' });
    setText('');
    setAnswer('');
    window.scrollTo({ top: 0 });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const backToRequest = () => {
    setView({ kind: 'idle' });
    setText(pendingRequest.current);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const pickChip = (starter: string) => {
    setText(starter);
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(starter.length, starter.length);
    }, 0);
  };

  if (view.kind === 'result') {
    return (
      <Shell>
        <main className="z-10 mx-auto w-full max-w-[820px] flex-1 px-3 pt-2 sm:px-6" data-testid="result-view">
          <ReportPanel run={view.run} cost={view.run.cost} evidence={view.run.evidence} onAgain={reset} />
        </main>
      </Shell>
    );
  }

  const busy = view.kind === 'running';

  return (
    <Shell>
      <main className={cn('z-10 flex w-full flex-1 flex-col items-center justify-center px-1.5 sm:px-6', view.kind === 'idle' && 'sm:mt-[-60px]')}>
        {view.kind === 'idle' && (
          <>
            <div className="mb-7 max-w-[680px] animate-fade-in px-1.5 text-center sm:px-4">
              <div className="mb-6">
                <Sphere size={140} />
              </div>
              <h1 className="mb-0 text-center font-inter text-[26px] font-semibold leading-tight text-black sm:text-[36px]">Know who you’re dealing with.</h1>
              <p className="mt-2 text-center font-inter text-[16px] font-normal leading-snug text-[#858481] sm:text-[20px]">
                Check a person or company before your next meeting, deal, or partnership.
              </p>
            </div>

            <div className="flex w-full flex-col items-center space-y-6 px-1.5 sm:px-4">
              <form onSubmit={submit} className="flex w-full max-w-[760px] flex-col items-center">
                <div
                  className="relative z-10 flex w-full flex-col rounded-2xl border bg-white p-4 transition-colors focus-within:ring-2 focus-within:ring-black"
                  style={{ borderColor: '#E0E0E0', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}
                >
                  <TextareaAutosize
                    ref={inputRef}
                    minRows={2}
                    maxRows={8}
                    autoFocus
                    aria-label="Who do you want to check, and why?"
                    placeholder="Who do you want to check, and why? Add a name, website, or profile link."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
                    }}
                    maxLength={MAX_TEXT_LENGTH}
                    data-testid="request-input"
                    className="w-full resize-none border-none bg-transparent p-0 text-base outline-none placeholder:text-[#B9B9B7] focus:ring-0 sm:text-sm"
                  />
                  {text.length > MAX_TEXT_LENGTH * 0.9 && (
                    <p className="mt-1 text-right text-xs text-gray-500">
                      {text.length} / {MAX_TEXT_LENGTH} characters
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={text.trim().length < 3}
                      data-testid="run-button"
                      className="flex h-9 items-center gap-1.5 rounded-full bg-black pl-3 pr-3.5 font-inter text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-[#D6D6D4]"
                    >
                      <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
                      <span>Run a check</span>
                    </button>
                  </div>
                </div>

                {/* One row of three on every screen: below sm the icons go and the row may scroll sideways on very narrow phones. */}
                <div className="mt-3 flex max-w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] min-[380px]:justify-center sm:gap-2 [&::-webkit-scrollbar]:hidden" data-testid="chips">
                  {CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => pickChip(chip.starter)}
                      className="flex h-10 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#F0F0F0] bg-white px-2.5 font-inter text-[12px] font-medium text-black transition-all duration-200 hover:scale-105 sm:h-9 sm:gap-2 sm:px-4 sm:text-[13px]"
                    >
                      <chip.icon className="hidden h-[18px] w-[18px] text-[#444343] sm:block" aria-hidden />
                      {chip.label}
                    </button>
                  ))}
                </div>
              </form>
            </div>
          </>
        )}

        {busy && (
          <div className="flex w-full max-w-[520px] flex-col items-center px-4 text-center" data-testid="running-view" aria-live="polite">
            <Sphere size={96} fast />
            <p className="mt-6 font-inter text-lg font-semibold text-black">{STAGE_COPY[view.stage]}…</p>
            <p className="mt-1 font-inter text-sm text-[#858481]">A check usually takes under a minute. Keep this page open.</p>
            <ol className="mt-6 w-full space-y-2 text-left">
              {STAGE_ORDER.map((stage) => {
                const at = STAGE_ORDER.indexOf(view.stage);
                const mine = STAGE_ORDER.indexOf(stage);
                return (
                  <li key={stage} className={cn('flex items-center gap-3 font-inter text-sm', mine < at ? 'text-black' : mine === at ? 'font-medium text-black' : 'text-[#B9B9B7]')}>
                    <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', mine < at ? 'bg-black' : mine === at ? 'animate-pulse bg-black' : 'bg-[#E0E0E0]')} aria-hidden />
                    {STAGE_COPY[stage]}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {view.kind === 'clarify' && (
          <div className="w-full max-w-[640px] px-3" data-testid="clarify-view">
            <div className="mb-5 flex justify-center">
              <Sphere size={72} />
            </div>
            <p className="whitespace-pre-line text-center font-inter text-lg font-semibold leading-snug text-black" data-testid="clarify-question">{view.question}</p>
            <form onSubmit={submitAnswer} className="mt-5 flex flex-col gap-3">
              <input
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={400}
                data-testid="clarify-input"
                placeholder={view.mode === 'subject' ? 'Name of the person or company' : 'A company, website, city or profile link'}
                className="block h-12 w-full rounded-full border border-[#E0E0E0] bg-white px-5 text-base shadow-[0_1px_3px_rgba(0,0,0,0.05)] outline-none placeholder:text-[#B9B9B7] focus-visible:ring-2 focus-visible:ring-black sm:text-sm"
              />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="submit" disabled={!answer.trim()} data-testid="clarify-continue" className="flex h-10 items-center rounded-full bg-black px-5 font-inter text-[13px] font-medium text-white hover:bg-gray-800 disabled:bg-[#D6D6D4] sm:h-9">
                  Continue
                </button>
                {view.mode === 'details' && (
                  <button type="button" onClick={() => void start(pendingRequest.current, 'just run it')} data-testid="clarify-run-anyway" className="flex h-10 items-center rounded-full border border-[#F0F0F0] bg-white px-4 font-inter text-[13px] font-medium text-black hover:bg-[#FAFAFA] sm:h-9">
                    Just run it
                  </button>
                )}
                <button type="button" onClick={backToRequest} className="flex h-10 items-center rounded-full border border-[#F0F0F0] bg-white px-4 font-inter text-[13px] font-medium text-black hover:bg-[#FAFAFA] sm:h-9">
                  Edit my request
                </button>
              </div>
            </form>
          </div>
        )}

        {view.kind === 'notice' && (
          <div className="w-full max-w-[560px] px-4 text-center" data-testid={`notice-${view.tone}`} role={view.tone === 'error' ? 'alert' : 'status'}>
            <p className="font-inter text-lg font-semibold text-black">
              {view.tone === 'refused' ? 'CheckCheck can’t help with this one' : view.tone === 'limit' ? 'Come back a little later' : view.tone === 'declined' ? 'No check was run' : 'That didn’t work'}
            </p>
            <p className="mt-2 font-inter text-sm leading-relaxed text-[#5F5E5B]">{view.message}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {view.tone === 'error' && (
                <button type="button" onClick={() => void start(pendingRequest.current)} className="flex h-10 items-center rounded-full bg-black px-5 font-inter text-[13px] font-medium text-white hover:bg-gray-800 sm:h-9">
                  Try again
                </button>
              )}
              <button type="button" onClick={backToRequest} className="flex h-10 items-center rounded-full border border-[#F0F0F0] bg-white px-4 font-inter text-[13px] font-medium text-black hover:bg-[#FAFAFA] sm:h-9">
                {view.tone === 'error' ? 'Edit my request' : 'Back'}
              </button>
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}
