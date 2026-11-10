import { Pencil } from 'lucide-react';
import { extractSourceChips, type SourceChip } from './sourceChips';

/**
 * Editing helpers for a briefing section (docs/CHECKCHECK_PLAN.md §12 step 3). The text is
 * edited in place (CheckBriefingView's EditableProse); these split a section's prose from
 * its source chips and join them back so a saved edit keeps the server's `"source"` chips.
 * Sources are view-only (founder 2026-10-01).
 */
// One pencil at a time (founder 2026-10-01): a pencil shows only while ITS element (`group/edit`) is hovered —
// never every pencil of the section. Touch screens have no hover, so there the pencils stay visible.
export const PENCIL_CLASS = 'inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover/edit:opacity-100 focus:opacity-100 max-lg:opacity-100';

export function splitProseAndChips(markdown: string): { prose: string; chips: SourceChip[] } {
  const blocks = markdown.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  const texts: string[] = [];
  const chips: SourceChip[] = [];
  for (const block of blocks) {
    const out = extractSourceChips(block.replace(/^Also read:\s*/i, ''));
    if (out.text) texts.push(out.text);
    for (const c of out.chips) if (!chips.some((p) => p.url === c.url)) chips.push(c);
  }
  return { prose: texts.join('\n\n'), chips };
}

export function joinProseAndChips(prose: string, chips: SourceChip[]): string {
  const body = prose.replace(/\r\n/g, '\n').trim();
  if (chips.length === 0) return body;
  const chipText = chips.map((c) => `[${c.name.replace(/[[\]]/g, '')}](${c.url} "source")`).join(' ');
  return body ? `${body}\n\n${chipText}` : chipText;
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el || el.clientWidth === 0) return;
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

/** The pencil that opens an editor; shown on hover of the enclosing `group/edit` (one element, one pencil). */
export function EditPencil({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className={PENCIL_CLASS} onClick={onClick} aria-label={label} title={label} data-testid="check-edit-pencil">
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}
