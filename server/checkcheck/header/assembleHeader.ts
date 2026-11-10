/**
 * The fast header, assembled without a model and without any search API
 * (founder 2026-09-29: "no search at all"): the user's words, the register's
 * officer list, Gravatar for a person with an email, the site icon for a
 * company. Links arrive later with the full report (validated there) and the
 * card folds them in.
 */
import type { CheckHeader, CheckSubjectInput, HeaderPicture, ProvidedRecord } from '../types';
import { domainFromInput } from '../records/rdap';

const FAVICON = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;

/** Lower-case letters and digits, single spaces. */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "SURNAME, Firstname Middle" (the register) ↔ "Firstname Surname" (the user): every word of the user's name is in the officer's. */
export function officerMatchesName(officerName: string, name: string): boolean {
  const officer = new Set(fold(officerName).split(' ').filter((w) => w.length >= 2));
  const words = fold(name).split(' ').filter((w) => w.length >= 2);
  return words.length > 0 && words.every((w) => officer.has(w));
}

/** Gravatar: the photo a person published against their own email address, keyed by its hash; `d=404` = no photo → the thumbnail hides itself. Free, no key. */
export function gravatarPicture(emailHash: string): HeaderPicture {
  return {
    url: `https://www.gravatar.com/avatar/${emailHash}?s=256&d=404`,
    kind: 'photo',
    source_url: `https://gravatar.com/${emailHash}`,
    source_title: 'Gravatar',
    caption: 'The photo published for their email address (Gravatar)',
  };
}

export interface AssembleInput {
  subject: CheckSubjectInput;
  records: ProvidedRecord[];
  startedAt: number;
  now?: Date;
}

export function assembleHeader(input: AssembleInput): CheckHeader {
  const { subject, records } = input;
  let currentPosition: CheckHeader['current_position'] = null;
  let born: CheckHeader['born'] = null;
  let registerName: string | null = null;

  const company = records.find((r) => r.source === 'companies_house' && !Array.isArray(r.fields.candidates));
  if (company) {
    const companyName = typeof company.fields.company_name === 'string' ? company.fields.company_name : subject.company ?? subject.name;
    const officers = (Array.isArray(company.fields.officers) ? company.fields.officers : []) as Array<Record<string, unknown>>;
    if (subject.type === 'person') {
      const officer = officers.find((o) => typeof o.name === 'string' && !o.resigned_on && officerMatchesName(o.name, subject.name));
      if (officer) {
        const role = typeof officer.role === 'string' ? officer.role.replace(/-/g, ' ') : 'officer';
        const since = typeof officer.appointed_on === 'string' ? ` since ${officer.appointed_on}` : '';
        currentPosition = { text: `${role.charAt(0).toUpperCase()}${role.slice(1)} of ${companyName}${since}`, source: 'register', source_url: company.url };
        const dob = officer.born as { month: number; year: number } | null | undefined;
        if (dob) born = { month: dob.month, year: dob.year, source_url: company.url };
      }
    } else {
      registerName = companyName;
      const status = typeof company.fields.company_status === 'string' ? company.fields.company_status : null;
      const since = typeof company.fields.date_of_creation === 'string' ? `, incorporated ${company.fields.date_of_creation}` : '';
      currentPosition = { text: `${status ? `${status.charAt(0).toUpperCase()}${status.slice(1)} UK company` : 'UK company'}${since}`, source: 'register', source_url: company.url };
    }
  }

  const pictures: HeaderPicture[] = [];
  const ownHost = domainFromInput(subject.website);
  if (subject.type === 'person' && subject.email_hash) pictures.push(gravatarPicture(subject.email_hash));
  if (subject.type === 'company' && ownHost) {
    pictures.push({ url: FAVICON(ownHost), kind: 'logo', source_url: `https://${ownHost}`, source_title: ownHost, caption: `Site icon of ${ownHost}` });
  }

  return {
    name: registerName ?? subject.name,
    type: subject.type,
    headline: currentPosition?.text ?? null,
    current_position: currentPosition,
    born,
    location: subject.location ?? null,
    pictures,
    note:
      subject.type === 'person' && !subject.email_hash
        ? 'No email on file, so there is no photo to show.'
        : subject.type === 'company' && !ownHost
          ? 'No website given, so there is no site icon to show.'
          : null,
    built_at: (input.now ?? new Date()).toISOString(),
    wall_ms: Date.now() - input.startedAt,
  };
}
