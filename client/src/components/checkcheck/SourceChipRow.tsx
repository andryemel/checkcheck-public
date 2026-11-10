import { useState } from 'react';
import { ComposerChip } from '@/components/shared/ComposerChip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { faviconUrl } from './sourcePages';
import type { SourceChip } from './sourceChips';

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !host) return <span className="inline-block h-4 w-4 flex-shrink-0 rounded-full bg-[#F0F0F0]" aria-hidden />;
  return <img src={faviconUrl(host)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-4 w-4 flex-shrink-0 rounded-full object-cover" />;
}

const PILL_CLASS = 'cursor-pointer font-normal transition-colors hover:bg-[#FAFAFA]';

/**
 * The one place a section's sources show (founder 2026-09-30): one pill at the bottom of the
 * card, in the SAME chip as the LinkedIn and website pills at the top — a single named pill
 * for one source, or up to three stacked favicons and "Sources" opening a popover with them all.
 */
export function SourceChipRow({ chips, modifiedOn }: { chips: SourceChip[]; modifiedOn?: string | null }) {
  const [open, setOpen] = useState(false);
  if (chips.length === 0) return null;
  // A section the owner changed says so first (founder 2026-10-01): one short line above the sources.
  const modified = modifiedOn ? (
    <li className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-black" data-testid="source-modified-line">
      <span className="truncate">Edited by you</span>
      <span className="ml-auto truncate pl-3 text-[11px] text-[#B9B9B7]">{modifiedOn}</span>
    </li>
  ) : null;
  if (chips.length === 1 && !modified) {
    const c = chips[0];
    return (
      <div className="flex items-center" data-testid="source-chip-row">
        <a href={c.url} target="_blank" rel="noopener noreferrer" title={c.url} className="no-underline">
          <ComposerChip icon={<Favicon host={c.host} />} label={c.name} className={PILL_CLASS} />
        </a>
      </div>
    );
  }
  return (
    <div className="flex items-center" data-testid="source-chip-row">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-expanded={open} aria-label={`${chips.length} sources`} className="rounded-full">
            <ComposerChip
              icon={
                <span className="flex items-center -space-x-1.5">
                  {chips.slice(0, 3).map((c) => <span key={c.url} className="rounded-full ring-2 ring-white"><Favicon host={c.host} /></span>)}
                </span>
              }
              label={chips.length === 1 ? chips[0].name : "Sources"}
              className={PILL_CLASS}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" sideOffset={6} avoidCollisions={false} className="z-[9999] w-auto max-w-[360px] rounded-3xl border-0 bg-white/80 p-3 shadow-lg backdrop-blur-sm">
          <ul className="flex flex-col gap-1">
            {modified}
            {chips.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" title={c.url} className="flex items-center gap-2 rounded-full px-2 py-1.5 text-[13px] text-black no-underline hover:bg-white">
                  <Favicon host={c.host} />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate pl-3 text-[11px] text-[#B9B9B7]">{c.host}</span>
                </a>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
