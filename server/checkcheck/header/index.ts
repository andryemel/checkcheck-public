/**
 * Build the fast header (plan §10): the user's words, the register's officer
 * list (already fetched with the records), Gravatar, the site icon. No model,
 * no search API (founder 2026-09-29). The caller writes it before the report.
 */
import type { CheckHeader, CheckSubjectInput, ProvidedRecord } from '../types';
import { assembleHeader } from './assembleHeader';

export async function buildHeader(subject: CheckSubjectInput, records: ProvidedRecord[]): Promise<CheckHeader> {
  return assembleHeader({ subject, records, startedAt: Date.now() });
}
