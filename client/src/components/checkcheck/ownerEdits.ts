/**
 * The owner's edits applied to a briefing on the client (mirror of the server's
 * ownerEdits.ts, docs/CHECKCHECK_PLAN.md §12): section bodies replaced by title,
 * the Profile name / location / role lines rewritten. The stored text is never
 * changed; both the chat card and the contact page read through this.
 */
import type { OwnerEdits } from '@/services/checkCheckService';
import type { BriefingSection } from './briefingSections';

export const sectionKey = (title: string | null): string => (title ?? '').trim().toLowerCase();

const PROFILE_LINE: Record<'name' | 'location' | 'role', RegExp> = {
  name: /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*Name\s*:?\s*(?:\*\*)?\s*:?\s*.+$/i,
  location: /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*Location\s*:?\s*(?:\*\*)?\s*:?\s*.+$/i,
  role: /^\s*(?:[-*+]\s+)?(?:\*\*)?\s*Current role\s*:?\s*(?:\*\*)?\s*:?\s*.+$/i,
};
const PROFILE_LABEL = { name: 'Name', location: 'Location', role: 'Current role' } as const;

export function applyProfileEdits(profileBody: string, profile: OwnerEdits['profile']): string {
  if (!profile) return profileBody;
  let lines = profileBody.split('\n');
  for (const field of ['name', 'location', 'role'] as const) {
    const value = profile[field];
    if (!value) continue;
    const index = lines.findIndex((line) => PROFILE_LINE[field].test(line));
    const written = `${PROFILE_LABEL[field]}: ${value}`;
    if (index >= 0) lines[index] = written;
    else lines = [written, ...lines];
  }
  return lines.join('\n');
}

/** Sections with the owner's edits applied; `edited` marks the ones that differ from the model's text. */
export function applyEditsToSections(sections: BriefingSection[], edits: OwnerEdits | null | undefined): Array<BriefingSection & { edited: boolean }> {
  return sections.map((section) => {
    const key = sectionKey(section.title);
    let body = section.body;
    let edited = false;
    // Own keys only: a section called "Constructor" is not Object's.
    if (edits?.sections && Object.prototype.hasOwnProperty.call(edits.sections, key)) { body = edits.sections[key]; edited = true; }
    if (section.title && /^profile$/i.test(section.title) && edits?.profile) { body = applyProfileEdits(body, edits.profile); edited = true; }
    return { ...section, body, edited };
  });
}

/** The "Current role:" value of a Profile body, or null. */
export function currentRoleOf(profileBody: string): string | null {
  const line = profileBody.split('\n').find((l) => PROFILE_LINE.role.test(l));
  return line ? line.replace(/^\s*(?:[-*+]\s+)?(?:\*\*)?\s*Current role\s*:?\s*(?:\*\*)?\s*:?\s*/i, '').replace(/\*\*/g, '').trim() : null;
}

export function hasTextEdits(edits: OwnerEdits | null | undefined): boolean {
  return !!edits && (Object.keys(edits.sections ?? {}).length > 0 || !!edits.profile || !!edits.links);
}
