/**
 * CheckCheck — types for the research run (docs/CHECKCHECK_PLAN.md §9).
 *
 * The report shape is the prompt's `card_data` contract v0.2
 * (server/constants/checkcheckPrompt.ts). The model fills it; the app VALIDATES
 * it (validateReport.ts) — every source URL against what was actually
 * retrieved, `access_level` derived by the app, `supported` only with a record
 * or a page read — and stores the validated object on `research_runs.report`.
 */

export type SubjectType = 'person' | 'company';

/** What the user (or the contact they started from) supplied. Anchors only — never notes or memory. */
export interface CheckSubjectInput {
  name: string;
  type: SubjectType;
  website?: string;
  profile_url?: string;
  company?: string;
  location?: string;
  /** A registry number the user typed (e.g. a Companies House number). */
  registry_number?: string;
  /** The subject's email — from the contact the check started from, or typed by the user THIS message. Never stored, never sent to the model. */
  email?: string;
  /** SHA-256 of the lower-cased email: what the run row keeps (Gravatar is keyed by it). */
  email_hash?: string;
  /** People and companies an earlier check named — identification help only (plan §13). */
  related_names?: string[];
}

export interface StartCheckInput {
  subject: CheckSubjectInput;
  /** The user's situation in their own words ("I'm meeting them about a kitchen refit"). */
  user_request: string;
  contact_id?: string;
}

export type ClaimStatus = 'supported' | 'self_reported' | 'reported' | 'inference' | 'conflicted';
export type CoverageState =
  | 'checked'
  | 'not_searched'
  | 'searched_no_match'
  | 'source_unavailable'
  | 'conflicting_sources'
  | 'needs_confirmation';
export type UnknownReason = CoverageState | 'insufficient_evidence';
export type SourceType = 'official_record' | 'first_party' | 'independent_reporting' | 'review_platform' | 'user_provided';
export type AccessLevel = 'page_read' | 'api_record' | 'indexed_content' | 'search_only' | 'provided_context';
export type SubjectMatch = 'matched' | 'ambiguous' | 'different';
export type ReportStatus = 'complete' | 'partial' | 'needs_clarification';
export type Angle = 'investor_meeting' | 'client_work' | 'new_connection' | 'supplier_work' | 'general';

export interface ReportSource {
  id: string;
  title: string | null;
  url: string | null;
  source_type: SourceType;
  access_level: AccessLevel;
  published_at: string | null;
  retrieved_at: string | null;
  entity_ids: string[];
  subject_match: SubjectMatch;
  identity_basis: string | null;
}

export interface ReportImage {
  url: string;
  kind: 'portrait' | 'logo';
  alt_text: string | null;
  source_id: string | null;
  source_page_url: string | null;
}

export interface ReportLink {
  label: string;
  platform: string | null;
  url: string;
  source_ids: string[];
}

export interface RelatedEntity {
  id: string;
  type: string;
  name: string;
  website: string | null;
  relationship: string;
  relationship_status: 'current' | 'former' | 'unknown';
  valid_from: string | null;
  valid_to: string | null;
  source_ids: string[];
}

export interface ReportSubject {
  id: string;
  type: SubjectType;
  display_name: string;
  headline: string | null;
  location: string | null;
  fact_ids: string[];
  image: ReportImage | null;
  links: ReportLink[];
  related_entities: RelatedEntity[];
}

export interface QuickFact {
  id: string;
  label: string;
  text: string;
  claim_status: ClaimStatus;
  as_of: string | null;
  source_ids: string[];
}

export interface Finding {
  id: string;
  title: string;
  text: string;
  relevance: string;
  claim_status: ClaimStatus;
  as_of: string | null;
  entity_ids: string[];
  source_ids: string[];
}

export interface Unknown {
  id: string;
  question: string;
  reason: UnknownReason;
  importance: string;
  next_step: string;
  related_item_ids: string[];
  source_ids: string[];
}

export interface ReportQuestion {
  id: string;
  text: string;
  based_on_item_ids: string[];
}

export interface FollowUpAction {
  id: string;
  label: string;
  action: 'answer_from_evidence' | 'research_more' | 'compare_sources' | 'refresh_topic' | 'research_related_entity';
  target_item_ids: string[];
  suggested_request: string;
}

export interface CoverageEntry {
  topic: string;
  state: CoverageState;
  detail: string;
  source_ids: string[];
}

export interface ClarificationCandidate {
  name: string;
  details: string;
  source_ids: string[];
}

export interface CheckReport {
  schema_version: string;
  status: ReportStatus;
  intent: { primary_angle: Angle; secondary_angles: Angle[]; goal: string };
  subject: ReportSubject;
  quick_facts: QuickFact[];
  summary: { text: string; supporting_item_ids: string[] };
  findings: Finding[];
  unknowns: Unknown[];
  questions: ReportQuestion[];
  follow_up_actions: FollowUpAction[];
  coverage: CoverageEntry[];
  sources: ReportSource[];
  clarification: { question: string; candidates: ClarificationCandidate[] } | null;
  continuation: null;
}

/** A record the APP fetched from a registry or list service before the model ran. */
export interface ProvidedRecord {
  id: string;
  source: 'companies_house' | 'rdap' | 'opensanctions' | 'website';
  title: string;
  url: string;
  retrieved_at: string;
  /** Structured fields exactly as the source returned them (trimmed, never interpreted). */
  fields: Record<string, unknown>;
  /** A fixed, app-written sentence about what this record does and does not prove. */
  note: string;
}

/** What each record source did — for the coverage section when a source could not run. */
export interface RecordCoverage {
  source: ProvidedRecord['source'];
  state: 'checked' | 'not_searched' | 'searched_no_match' | 'source_unavailable' | 'needs_confirmation';
  detail: string;
}

export interface RecordsResult {
  records: ProvidedRecord[];
  coverage: RecordCoverage[];
}

export type RunStatus = 'running' | ReportStatus | 'refused' | 'failed';

export interface HeaderPicture {
  url: string;
  kind: 'photo' | 'logo';
  /** The page the picture sits on (linked under the thumbnail). */
  source_url: string;
  source_title: string;
  caption: string;
}

/**
 * The fast header (plan §10): no model, no search API (founder 2026-09-29) — the
 * register's officer list, the user's words, Gravatar, the site icon. Links come
 * with the full report and the card folds them in.
 */
export interface CheckHeader {
  name: string;
  type: SubjectType;
  headline: string | null;
  current_position: { text: string; source: 'register'; source_url: string } | null;
  born: { month: number; year: number; source_url: string } | null;
  location: string | null;
  pictures: HeaderPicture[];
  /** Why there is no picture, in plain words, or null. */
  note: string | null;
  /** The owner's own history with this contact, app-built and exact (plan §12 step 4); null when the check ran from no contact. */
  history?: string | null;
  built_at: string;
  wall_ms: number;
}

export interface ValidationStats {
  sources_total: number;
  sources_kept: number;
  sources_dropped: number;
  items_moved_to_unknowns: number;
  claims_downgraded: number;
  retrieved_urls: number;
  /** Citations whose URL was a guess for a domain Google did retrieve — pointed at the page actually retrieved. */
  sources_rehomed: number;
  dropped: Array<{ id: string; url: string | null; reason: string }>;
  rehomed: Array<{ id: string; cited: string; replaced_by: string }>;
}

/**
 * The owner's edits to a briefing (plan §12, 2026-10-01). `briefing_text` is never
 * rewritten (the piece_edits precedent): every reader applies these on top.
 * `sections` are keyed by the section title ("In brief", "Business context", …;
 * the untitled lead-in is keyed ""); a section text here replaces the model's body.
 */
export interface OwnerEdits {
  v: 1;
  sections?: Record<string, string>;
  links?: { linkedin?: string | null; website?: string | null; extra?: Array<{ label: string; url: string }> };
  profile?: { name?: string | null; location?: string | null; role?: string | null };
  /** Whether the report may inform drafts for this contact (default true when absent). */
  use_in_drafts?: boolean;
  /** The card's "Add to your contacts?" was answered "Not now". */
  contact_offer?: 'dismissed';
  edited_at?: string;
}

export interface ResearchRunRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  subject: CheckSubjectInput;
  user_request: string | null;
  angle: string | null;
  status: RunStatus;
  stop_reason: string | null;
  report: CheckReport | null;
  /** Briefing mode (CHECKCHECK_OUTPUT=briefing): the link-validated Markdown; `report` is null then. */
  briefing_text: string | null;
  header: CheckHeader | null;
  /** The owner's edits (plan §12); null until the owner changes something. */
  owner_edits?: OwnerEdits | null;
  records: ProvidedRecord[];
  validation: ValidationStats | Record<string, unknown> | null;
  models: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  prompt_version: string | null;
  created_at: string;
  completed_at: string | null;
  /** Null since 2026-10-01 (reports are kept for as long as the contact is); older rows were nulled by migration 20261001150000. */
  expires_at: string | null;
}
