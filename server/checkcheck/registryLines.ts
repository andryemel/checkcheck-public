/**
 * Register facts written by the app, not the model (plan 2026-09-30, Phase B item 9):
 * director, appointment, status, incorporation and registered office are exact legal
 * facts, and the bench showed the model blurring them ("director" → "shareholder").
 * When a matched Companies House record exists, these lines are given to the model to
 * copy verbatim and, if it did not, appended under Business context after validation.
 * The officers' month/year of birth on the record is never written.
 */
import type { ProvidedRecord } from './types';

const REGISTER_URL = 'https://find-and-update.company-information.service.gov.uk/company/';

function formatDate(iso: unknown): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}

function titleCase(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  // Register names are "SURNAME, Given Names": show as Given Names Surname.
  const m = /^([^,]+),\s*(.+)$/.exec(name.trim());
  const raw = m ? `${m[2].trim()} ${m[1].trim()}` : name.trim();
  return raw.split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
}

export function registryLines(records: ProvidedRecord[]): string[] {
  const record = records.find((r) => r.source === 'companies_house' && r.fields && typeof r.fields.company_number === 'string' && !('candidates' in r.fields));
  if (!record) return [];
  const f = record.fields as Record<string, unknown>;
  const number = String(f.company_number);
  const url = record.url || `${REGISTER_URL}${number}`;
  const lines: string[] = [];
  const name = typeof f.company_name === 'string' ? f.company_name : null;
  const status = typeof f.company_status === 'string' ? f.company_status.replace(/-/g, ' ') : null;
  const created = formatDate(f.date_of_creation);
  const office = typeof f.registered_office === 'string' ? f.registered_office : null;
  const identity = [`**Legal identity:** ${name ?? 'Company'} (company number ${number})`, status ? `status ${status}` : null, created ? `incorporated ${created}` : null, office ? `registered office ${office}` : null].filter(Boolean).join(', ');
  lines.push(`${identity} ([Companies House](${url})).`);
  const officers = Array.isArray(f.officers) ? (f.officers as Array<Record<string, unknown>>) : [];
  const current = officers.filter((o) => !o.resigned_on).map((o) => {
    const who = titleCase(o.name);
    const role = typeof o.role === 'string' ? o.role.replace(/-/g, ' ') : 'officer';
    const since = formatDate(o.appointed_on);
    return who ? `${who} (${role}${since ? `, appointed ${since}` : ''})` : null;
  }).filter((x): x is string => !!x);
  if (current.length > 0) lines.push(`**Officers on the register:** ${current.join('; ')} ([Companies House](${url}/officers)).`);
  return lines;
}

/** Appends the register lines under Business context when the text does not carry the company number already. */
export function ensureRegistryLines(text: string, lines: string[]): { text: string; appended: boolean } {
  if (lines.length === 0) return { text, appended: false };
  const number = /company number ([A-Za-z0-9]+)/.exec(lines[0])?.[1];
  if (number && text.includes(number) && /Legal identity/i.test(text)) return { text, appended: false };
  const block = lines.map((l) => `- ${l}`).join('\n');
  const heading = /^#+\s*Business context\s*$/m.exec(text);
  if (heading && heading.index !== undefined) {
    const start = heading.index + heading[0].length;
    const rest = text.slice(start);
    const next = rest.search(/\n#+\s/);
    const sectionEnd = next >= 0 ? start + next : text.length;
    return { text: `${text.slice(0, sectionEnd).replace(/\s+$/, '')}\n\n${block}\n${text.slice(sectionEnd)}`, appended: true };
  }
  return { text: `${text.replace(/\s+$/, '')}\n\n# Business context\n${block}`, appended: true };
}
