/**
 * The records the app fetches ITSELF before the model runs (docs/CHECKCHECK_PLAN.md §2.1):
 * structured JSON from registries and list services, so the strongest facts —
 * exists, since when, status, officers, domain age, list match — are proved by
 * code comparing fields, never by a model's quotation of a web page.
 *
 * Each source is guarded on its own: a missing key, a timeout or a 5xx becomes
 * a coverage line (`not_searched` / `source_unavailable`), never a thrown error
 * and never silence.
 */
import type { CheckSubjectInput, RecordsResult } from '../types';
import { domainFromInput, lookupDomainRegistration } from './rdap';
import { lookupCompaniesHouse } from './companiesHouse';
import { fetchWebsiteRecord } from './website';
import { lookupSanctions } from './sanctions';

export async function collectRecords(subject: CheckSubjectInput): Promise<RecordsResult> {
  let counter = 0;
  const nextId = () => `r${++counter}`;
  const result: RecordsResult = { records: [], coverage: [] };

  const companyName = subject.type === 'company' ? subject.name : (subject.company ?? '').trim();
  const domain = domainFromInput(subject.website);

  const [rdap, companiesHouse, sanctions] = await Promise.all([
    domain
      ? lookupDomainRegistration(domain, nextId)
      : Promise.resolve({ record: null, coverage: { source: 'rdap' as const, state: 'not_searched' as const, detail: 'No website given, so the domain registration was not checked.' } }),
    companyName
      ? lookupCompaniesHouse(companyName, subject.registry_number, nextId)
      : Promise.resolve({ records: [], resolution: 'not_searched' as const, coverage: { source: 'companies_house' as const, state: 'not_searched' as const, detail: 'No company name given, so the UK register was not checked.' } }),
    // A one-word name against the lists is noise by construction (plan §10): skipped, and said so.
    subject.name.trim().split(/\s+/).length >= 2
      ? lookupSanctions(subject.name, subject.type, nextId)
      : Promise.resolve({ record: null, coverage: { source: 'opensanctions' as const, state: 'not_searched' as const, detail: 'Sanctions lists not checked: a single-word name cannot be matched meaningfully.' } }),
  ]);

  if (rdap.record) result.records.push(rdap.record);
  result.coverage.push(rdap.coverage);
  result.records.push(...companiesHouse.records);
  result.coverage.push(companiesHouse.coverage);
  if (sanctions.record) result.records.push(sanctions.record);
  result.coverage.push(sanctions.coverage);
  // The subject's own website text, as a record (bench 2026-09-30) — only when a website is known.
  if (subject.website) {
    const site = await fetchWebsiteRecord(subject.website, nextId());
    if (site.record) result.records.push(site.record);
    result.coverage.push(site.coverage);
  }
  return result;
}
