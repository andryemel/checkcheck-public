/**
 * Splits a briefing (CHECKCHECK_OUTPUT=briefing, prompt v0.3) into titled sections so the
 * chat card can render it the way the Skills settings pages do: one grey section per
 * heading, the body on a white card. A section starts at a Markdown heading (`# At a
 * glance`) or at a line that is nothing but bold text (the app's own
 * `**Sources checked on …**` line). Text before the first heading becomes an untitled
 * section. Pure; the Markdown itself is not rewritten.
 */
export interface BriefingSection {
  title: string | null;
  body: string;
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\*\*([^*]+)\*\*\s*$/;

function titleOf(line: string): string | null {
  const heading = HEADING.exec(line);
  if (heading) return heading[1].trim();
  const bold = BOLD_LINE.exec(line);
  return bold ? bold[1].trim() : null;
}

export function splitBriefingSections(text: string): BriefingSection[] {
  const sections: BriefingSection[] = [];
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };
  let inFence = false;
  const push = () => {
    const body = current.lines.join('\n').trim();
    if (current.title !== null || body) sections.push({ title: current.title, body });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) inFence = !inFence;
    const title = inFence ? null : titleOf(line.trim());
    if (title !== null) {
      push();
      current = { title, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  push();
  return sections;
}

/**
 * The Profile section's "Name:" and "Location:" lines become the section's title and
 * subtitle (founder 2026-09-30), so they are lifted out of the body. Both the bullet
 * form (`* **Name:** X`) and the plain form (`Name: X`) are read; anything else stays.
 */
export interface ProfileHeading {
  name: string | null;
  location: string | null;
  body: string;
}

const PROFILE_FIELD = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(Name|Location)\s*:?\s*(?:\*\*|__)?\s*:?\s*(.+?)\s*$/i;

export function extractProfileHeading(body: string): ProfileHeading {
  let name: string | null = null;
  let location: string | null = null;
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const m = PROFILE_FIELD.exec(line);
    if (m && m[1].toLowerCase() === 'name' && name === null) { name = m[2].replace(/\*\*|__/g, '').trim(); continue; }
    if (m && m[1].toLowerCase() === 'location' && location === null) { location = m[2].replace(/\*\*|__/g, '').trim(); continue; }
    kept.push(line);
  }
  return { name, location, body: kept.join('\n').trim() };
}
