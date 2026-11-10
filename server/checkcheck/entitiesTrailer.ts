/**
 * The briefing's entity trailer (2026-09-30, founder: every person and company name
 * gets a link). The app asks the model — in its OWN output additions, not the
 * founder's prompt — to end the answer with one line:
 *
 *   Entities: people: Jane Example; John Sample | companies: Acme Ltd; Example Corp
 *
 * The line is parsed and STRIPPED here so the reader never sees it; the lists ride on
 * the run's `validation.entities` and the card links every mention from them. A
 * missing or malformed line simply yields empty lists — nothing else changes.
 */
export interface BriefingEntities {
  people: string[];
  companies: string[];
}

const TRAILER_LINE = /^[ \t]*(?:\*\*|__|#+\s*)?\s*Entities\s*:?\s*(?:\*\*|__)?\s*:?[ \t]*(.*)$/im;
const MAX_NAMES = 40;
const MAX_NAME_LENGTH = 80;

function namesOf(segment: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of segment.split(/[;,]/)) {
    const name = raw.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    if (!name || /^(none|n\/a|-|—)$/i.test(name) || name.length > MAX_NAME_LENGTH) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

export function parseEntitiesLine(line: string): BriefingEntities {
  const people = /people\s*:\s*([^|]*)/i.exec(line)?.[1] ?? '';
  const companies = /compan(?:y|ies)\s*:\s*([^|]*)/i.exec(line)?.[1] ?? '';
  return { people: namesOf(people), companies: namesOf(companies) };
}

/** Removes the trailer from the text (wherever the model put it) and returns the lists. */
export function extractEntitiesTrailer(text: string): { text: string; entities: BriefingEntities } {
  const match = TRAILER_LINE.exec(text);
  if (!match) return { text, entities: { people: [], companies: [] } };
  const entities = parseEntitiesLine(match[1]);
  const stripped = text.replace(TRAILER_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: stripped, entities };
}
