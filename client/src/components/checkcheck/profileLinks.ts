/**
 * Company names in the Profile role lines become links (founder 2026-09-30):
 * "Co-founder at Acme" → "Co-founder at [Acme](https://acme.example)". The target
 * is, in order: a link the briefing already carries under that label (the model's
 * "Links: [Acme](…)" line, validated server-side), a verified page whose host
 * carries the name, else a Google search for the company. The prose class renders
 * every link semibold, so the name reads like an entity link.
 *
 * The "Links:" / "Direct identity links:" lines and sections are not shown: the
 * pill row carries the links now. They stay in the stored text as evidence.
 */
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const ROLE_LINE = /^(\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:Current|Previous|Past|Former)\s+Roles?\s*:?\s*(?:\*\*|__)?\s*:?\s*)(.+?)(\s*)$/i;
const LINKS_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:Direct\s+identity\s+)?(?:Identity\s+)?(?:Profile\s+)?links?\s*:?\s*(?:\*\*|__)?\s*:?/i;
export const LINKS_SECTION_TITLE = /^(direct\s+identity\s+links?|identity\s+links?|links?|profile\s+links?)\s*:?$/i;

export interface CompanyLinkIndex {
  /** lowercase label → url, from the briefing's own validated links */
  byLabel: Map<string, string>;
  /** verified page urls (validation decisions' finals) */
  finals: string[];
}

export function buildCompanyLinkIndex(briefingText: string, finals: Array<string | null | undefined>): CompanyLinkIndex {
  const byLabel = new Map<string, string>();
  for (const m of briefingText.matchAll(MARKDOWN_LINK)) {
    const label = m[1].replace(/\*\*|__/g, '').trim().toLowerCase();
    if (label && !byLabel.has(label)) byLabel.set(label, m[2]);
  }
  return { byLabel, finals: finals.filter((f): f is string => typeof f === 'string' && f !== '') };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const SEARCH_HOSTS = ['google.com', 'linkedin.com', 'find-and-update.company-information.service.gov.uk'];

export function companyLinkTarget(company: string, index: CompanyLinkIndex): string {
  const key = company.trim().toLowerCase();
  const labelled = index.byLabel.get(key) ?? [...index.byLabel.entries()].find(([label]) => label.includes(key) && /website|official|site|\.[a-z]{2,}$/i.test(label))?.[1];
  if (labelled) return labelled;
  const token = key.replace(/[^\p{L}\p{N}]+/gu, '');
  if (token.length >= 4) {
    const page = index.finals.find((url) => {
      const host = hostOf(url);
      return !!host && host.replace(/[^a-z0-9]/g, '').includes(token) && !SEARCH_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
    });
    if (page) return page;
  }
  return googleSearchUrl([company]);
}

/**
 * "… at Acme" / "… at Example Corp (2018–2024)": the company is the text after the last " at ", before any
 * trailing bracket or period. "Partner and Co-founder, EVC" (bench 2026-09-30): the comma form — the
 * tail after the last comma when it is one to four capitalised words.
 */
function splitRoleCompany(text: string): { before: string; company: string; after: string } | null {
  const at = /^(.*\bat\s+)([^()[\],;]+?)(\s*(?:\([^)]*\))?\.?)$/i.exec(text);
  if (at) {
    const company = at[2].trim();
    if (!company || /\]\(/.test(at[2]) || company.length > 60) return null;
    return { before: at[1], company, after: at[3] };
  }
  const comma = /^(.*,\s+)((?:[A-Z][\w&.'-]*)(?:\s+[A-Z][\w&.'-]*){0,3})(\s*(?:\([^)]*\))?\.?)$/.exec(text);
  if (comma && !/\]\(/.test(comma[2])) return { before: comma[1], company: comma[2], after: comma[3] };
  return null;
}

export function linkifyRoleCompanies(profileBody: string, index: CompanyLinkIndex): string {
  return profileBody
    .split('\n')
    .map((line) => {
      const m = ROLE_LINE.exec(line);
      if (!m) return line;
      const parts = splitRoleCompany(m[2]);
      if (!parts) return line;
      return `${m[1]}${parts.before}[${parts.company}](${companyLinkTarget(parts.company, index)})${parts.after}${m[3]}`;
    })
    .join('\n');
}

/** Drop the Links line(s) from a Profile body: the pills carry them. */
export function stripLinksLines(profileBody: string): string {
  return profileBody
    .split('\n')
    .filter((line) => !LINKS_LINE.test(line))
    .join('\n')
    .trim();
}

/**
 * The Profile body as shown (founder 2026-09-30, final): ONLY the current role, without its
 * label — "Co-Founder and Managing Partner at EVC (Example Venture Collective)". The previous
 * role and every other Profile line stay in the stored text but are not shown (the Currently /
 * Previously companies still drive the pills and the links).
 */
const BULLET = /^\s*[-*+]\s+/;
const CURRENT_LABEL = /^(?:\*\*|__)?\s*(?:Current\s+Roles?|Currently)\s*:?\s*(?:\*\*|__)?\s*:?\s*/i;

export function tidyProfileBody(profileBody: string): string {
  const current = profileBody
    .split('\n')
    .map((line) => line.replace(BULLET, ''))
    .find((line) => CURRENT_LABEL.test(line));
  return current ? current.replace(CURRENT_LABEL, '').trim() : '';
}

/**
 * Company mentions in the prose get the same link as the role lines (founder
 * 2026-09-30, "add links"): the first mention of each known company in every
 * paragraph becomes a link. Known = the companies of the Profile role lines, the
 * subject's company, and the labels of the briefing's own validated links. Text
 * already inside a link is left alone; names are matched as whole words.
 */
export function roleCompanies(profileBody: string): string[] {
  const names: string[] = [];
  for (const line of profileBody.split('\n')) {
    const m = ROLE_LINE.exec(line);
    const parts = m ? splitRoleCompany(m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')) : null;
    if (parts && !names.includes(parts.company)) names.push(parts.company);
  }
  return names;
}

export function collectCompanyNames(profileBody: string, subjectCompany: string | undefined, index: CompanyLinkIndex): string[] {
  const names = new Set<string>(roleCompanies(profileBody));
  if (subjectCompany && subjectCompany.trim()) names.add(subjectCompany.trim());
  // Link labels are indexed lowercase; a label that only repeats a known name (case aside) adds nothing.
  const known = new Set([...names].map((n) => n.toLowerCase()));
  for (const label of index.byLabel.keys()) {
    if (label.length >= 3 && label.length <= 40 && !known.has(label) && !/website|official|profile|search|linkedin|companies house|page|site/i.test(label)) names.add(label);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function linkifyMentions(markdown: string, names: string[], index: CompanyLinkIndex): string {
  return linkifyEntities(markdown, names.map((name) => ({ name, url: companyLinkTarget(name, index) })));
}

export function linkifyEntities(markdown: string, links: EntityLink[]): string {
  if (links.length === 0) return markdown;
  return markdown
    .split(/\n[ \t]*\n/)
    .map((block) => {
      if (/^\s*#/.test(block)) return block;
      let out = block;
      for (const { name, url } of links) {
        // Segments outside existing markdown links; link the first whole-word mention only.
        const segments = out.split(/(\[[^\]]*\]\([^)]*\))/);
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(name)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
        let done = false;
        out = segments
          .map((segment, i) => {
            if (done || i % 2 === 1) return segment;
            const m = pattern.exec(segment);
            if (!m || m.index === undefined) return segment;
            done = true;
            const at = m.index + m[1].length;
            return `${segment.slice(0, at)}[${m[2]}](${url})${segment.slice(at + m[2].length)}`;
          })
          .join('');
      }
      return out;
    })
    .join('\n\n');
}

/**
 * Every person and company the model named (validation.entities, from the trailer the
 * app asks for) gets a link target (founder 2026-09-30): a company uses the same
 * order as the role lines (the briefing's own link, a verified page on its host, else
 * a quoted Google search); a person gets a quoted Google search with a company as
 * the disambiguator — the subject's Currently company for the subject, the subject's
 * company for everyone else. The subject's own name links too.
 */
export interface BriefingEntities {
  people?: string[];
  companies?: string[];
}

export interface EntityLink {
  name: string;
  url: string;
}

export function googleSearchUrl(parts: Array<string | null | undefined>): string {
  const q = parts.filter((p): p is string => !!p && p.trim() !== '').map((p, i) => (i === 0 ? `"${p.trim()}"` : p.trim())).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function buildEntityLinks(
  entities: BriefingEntities | null | undefined,
  subject: { name: string; type: 'person' | 'company'; company?: string },
  roleCompanies: string[],
  index: CompanyLinkIndex,
): EntityLink[] {
  const out = new Map<string, EntityLink>();
  const add = (name: string, url: string) => {
    const key = name.trim().toLowerCase();
    if (key && !out.has(key)) out.set(key, { name: name.trim(), url });
  };
  const subjectCompany = subject.type === 'company' ? subject.name : roleCompanies[0] ?? subject.company ?? null;
  for (const company of [...(subject.type === 'company' ? [subject.name] : []), ...roleCompanies, ...(subject.company ? [subject.company] : []), ...(entities?.companies ?? [])]) {
    add(company, companyLinkTarget(company, index));
  }
  for (const person of [...(subject.type === 'person' ? [subject.name] : []), ...(entities?.people ?? [])]) {
    const isSubject = subject.type === 'person' && person.trim().toLowerCase() === subject.name.trim().toLowerCase();
    add(person, googleSearchUrl([person, isSubject ? subjectCompany : subjectCompany]));
  }
  return [...out.values()].sort((a, b) => b.name.length - a.name.length);
}

/** Company targets: quoted Google search when nothing verified backs the name. */
export function companySearchUrl(company: string): string {
  return googleSearchUrl([company]);
}
