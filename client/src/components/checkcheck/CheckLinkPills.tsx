import { useState } from 'react';
import { ComposerChip } from '@/components/shared/ComposerChip';
import type { CheckLinkPill } from './checkLinks';
import { faviconUrl } from './sourcePages';

const VISIBLE = 8;

/** A rounded favicon from Google's icon service; a failed load leaves a blank disc so the row keeps its rhythm. */
export function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="inline-block h-4 w-4 flex-shrink-0 rounded-full bg-[#F0F0F0]" aria-hidden />;
  return <img src={faviconUrl(host)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-4 w-4 flex-shrink-0 rounded-full object-cover" />;
}

/**
 * The pill row under Profile (founder 2026-09-30): minimal — a rounded favicon, then the name
 * only ("LinkedIn", "Acme", "Bloomberg", "Financial Times"). Identity links first, then the
 * pages the run read. Eight, then "See all".
 */
export function CheckLinkPills({ pills }: { pills: CheckLinkPill[] }) {
  const [expanded, setExpanded] = useState(false);
  if (pills.length === 0) return null;
  const shown = expanded ? pills : pills.slice(0, VISIBLE);
  return (
    <div className="flex flex-wrap gap-2" data-testid="check-link-pills">
      {shown.map((pill) => (
        <a key={`${pill.kind}:${pill.url}`} href={pill.url} target="_blank" rel="noopener noreferrer" title={pill.url} data-kind={pill.kind} className="no-underline">
          <ComposerChip icon={<Favicon host={pill.host} />} label={pill.label} className="cursor-pointer font-normal transition-colors hover:bg-[#FAFAFA]" />
        </a>
      ))}
      {pills.length > VISIBLE && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex h-9 items-center px-1 text-[13px] font-semibold text-black transition-opacity hover:opacity-60" aria-expanded={expanded}>
          {expanded ? 'See less' : 'See all'}
        </button>
      )}
    </div>
  );
}
