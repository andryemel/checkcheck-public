/**
 * The report types the CheckCheck view reads (the same shapes as in Jinna), plus the two save
 * calls the view imports. This public page is read-only: the view is always rendered with
 * `editable={false}` and no contact offer, so the save calls are never reached; they reject
 * rather than pretend.
 */
export type SubjectType = 'person' | 'company';
export type RunStatus = 'running' | 'complete' | 'partial' | 'needs_clarification' | 'refused' | 'failed';

export interface CheckSubjectInput {
  name: string;
  type: SubjectType;
  website?: string;
  profile_url?: string;
  company?: string;
  location?: string;
  registry_number?: string;
}

export interface ProvidedRecord {
  id: string;
  source: 'companies_house' | 'rdap' | 'opensanctions' | 'website';
  title: string;
  url: string;
  retrieved_at: string;
  fields: Record<string, unknown>;
  note: string;
}

export interface HeaderPicture { url: string; kind: 'photo' | 'logo'; source_url: string; source_title: string; caption: string }
export interface CheckHeader {
  name: string;
  type: SubjectType;
  headline: string | null;
  current_position: { text: string; source: 'register'; source_url: string } | null;
  born: { month: number; year: number; source_url: string } | null;
  location: string | null;
  pictures: HeaderPicture[];
  note: string | null;
  history?: string | null;
  built_at: string;
  wall_ms: number;
}

export interface OwnerEdits {
  v: 1;
  sections?: Record<string, string>;
  links?: { linkedin?: string | null; website?: string | null; extra?: Array<{ label: string; url: string }> };
  profile?: { name?: string | null; location?: string | null; role?: string | null };
  use_in_drafts?: boolean;
  contact_offer?: 'dismissed';
  edited_at?: string;
}

export interface OwnerEditsPatch {
  sections?: Record<string, string | null>;
  links?: { linkedin?: string | null; website?: string | null; extra?: Array<{ label?: string | null; url: string }> | null };
  profile?: { name?: string | null; location?: string | null; role?: string | null };
  use_in_drafts?: boolean;
  contact_offer?: 'dismissed' | null;
  restore?: boolean;
}

export interface CheckRun {
  id: string;
  status: RunStatus;
  stop_reason: string | null;
  refusal: { reason: string; message: string } | null;
  subject: CheckSubjectInput;
  user_request: string | null;
  angle: string | null;
  contact_id: string | null;
  report: null;
  briefing_text?: string | null;
  header: CheckHeader | null;
  owner_edits?: OwnerEdits | null;
  matching_contacts?: Array<{ id: string; name: string }>;
  records: ProvidedRecord[];
  validation: Record<string, unknown> | null;
  models: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

export async function saveCheckContact(_id: string, _links: { website?: string; linkedin?: string }): Promise<{ contact_id: string; created: boolean; website: string | null }> {
  throw new Error('Contacts are part of Jinna; this public page is read-only.');
}

export async function saveCheckEdits(_id: string, _patch: OwnerEditsPatch): Promise<{ owner_edits: OwnerEdits | null }> {
  throw new Error('Editing is part of Jinna; this public page is read-only.');
}
