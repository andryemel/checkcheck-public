/**
 * The one question before a check on a bare personal name, and the reader of the research's own
 * clarification question. Pure functions; the standalone demo keeps no server-side question state.
 */
export interface DetailsSubject {
  type: 'person' | 'company';
  website?: string;
  company?: string;
  location?: string;
  email?: string;
  profile_url?: string;
  registry_number?: string;
}

/**
 * The research came back as a QUESTION instead of a briefing ("Which Acme Design LLC? A state or website…").
 * A briefing always opens with a heading; a clarification has none and its first paragraph asks. The
 * question is that first paragraph, and the reason (the next one, if any) rides with it.
 */
export function clarificationOf(text: string): string | null {
  const body = (text ?? '').replace(/\n\*\*Sources checked[\s\S]*$/i, '').trim();
  if (!body || /^#{1,4}\s/m.test(body)) return null;
  // A question is short and opens by asking: the first SENTENCE ends with "?" (live 2026-10-01: the question and
  // its reason came as one paragraph, which a paragraph-end test missed and the card showed as a report).
  if (body.length > 1500) return null;
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] ?? '';
  if (!/\?\s*$/.test(firstSentence)) return null;
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.slice(0, 2).join('\n\n');
}

export function needsDetailsQuestion(subject: DetailsSubject, contactId: string | undefined | null): boolean {
  if (contactId) return false;
  if (subject.type !== 'person') return false;
  return !(subject.website || subject.company || subject.location || subject.email || subject.profile_url || subject.registry_number);
}

export function buildDetailsQuestion(name: string): string {
  return `Which ${name}? A company, website, city or email address would help — or say "just run it".`;
}

export interface ParsedDetails {
  email?: string;
  website?: string;
  company?: string;
  location?: string;
  /** The answer as typed: it rides as the situation so the research sees it in the user's words. */
  note: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i;
const COMPANY_RE = /\b(?:from|at|works? (?:at|for)|founder of|ceo of|owner of|runs|company[:\s]+)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/;
const LOCATION_RE = /\b(?:in|based in|lives in|located in|city[:\s]+)\s+([A-Z][\w'-]*(?:[\s,]+[A-Z][\w'-]*){0,2})\b/;

export function parseDetailsAnswer(text: string): ParsedDetails {
  const note = text.trim().replace(/\s+/g, ' ');
  const details: ParsedDetails = { note };
  const email = EMAIL_RE.exec(note)?.[0];
  if (email) details.email = email.toLowerCase();
  const withoutEmail = email ? note.replace(email, ' ') : note;
  const url = URL_RE.exec(withoutEmail)?.[0];
  if (url && !/^(?:e\.g|i\.e|etc)\./i.test(url)) details.website = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const company = COMPANY_RE.exec(withoutEmail)?.[1];
  if (company) details.company = company.replace(/[.,;]+$/, '').trim();
  const location = LOCATION_RE.exec(withoutEmail)?.[1];
  if (location && location !== details.company) details.location = location.replace(/[.,;]+$/, '').trim();
  return details;
}

export type DetailsAnswer = { kind: 'run' } | { kind: 'declined' } | { kind: 'details'; details: ParsedDetails };

/** The fixed reply when the owner says no to the question: nothing runs. */
export const CHECK_DECLINED_LINE = "Okay, I won't run the check.";

const RUN_AS_IS = /^\s*(?:(?:just|ok|okay|yes|sure|fine|please)[,\s]+)*(?:run|go|do|proceed|search|check|try)(?:\s+(?:it|ahead|anyway|the\s+check|with\s+(?:the|that|this)\s+name|as\s+is|without))?[\s.!]*$/i;
const BARE_YES = /^\s*(?:yes|yep|yeah|ok|okay|sure|go ahead|fine)[\s.!]*$/i;
/** A new request, not an answer: an instruction verb at the head or a business object. */
const NEW_REQUEST = /^\s*(?:please\s+)?(?:create|make|send|draft|write|invoice|email|schedule|book|add|update|delete|remove|show|list|open|remind|mark|pay|convert|generate|cancel|stop|start)\b/i;
/** "no", "never mind", "forget it": the check is called off — never read as details (a run on the bare name). */
const DECLINE = /^\s*(?:(?:oh|ah|ok|okay|well|hmm|actually|sorry)[,\s]+)*(?:no(?:pe|ne)?|nah|never\s*mind|nevermind|forget\s+(?:it|about\s+it|that)|cancel(?:\s+(?:it|that|the\s+check))?|stop(?:\s+(?:it|that))?|don'?t(?:\s+(?:bother|run\s+it|check))?|do\s+not(?:\s+(?:bother|run\s+it|check))?|skip(?:\s+it)?|leave\s+it|not\s+now|no\s+thanks?|no\s+thank\s+you|no\s+need)(?:[,\s]+(?:thanks?|thank\s+you|please))?[\s.!]*$/i;
/** Small talk and new questions are not an answer to "Which X?": the question is left behind. */
const NOT_AN_ANSWER = /^\s*(?:thanks?|thank\s+you|thx|cheers|hmm+|hi|hello|hey|great|cool|nice|lol|good|who\s+are\s+you|how\s+are\s+you)[\s.!?]*$|^\s*(?:who|what|why|how|when|where|can|could|do|does|are|is|will|would|should)\b[^?]*\?\s*$/i;
const BUSINESS_OBJECT = /\b(?:invoices?|estimates?|proposals?|quotes?|tasks?|calendar|meetings?|emails?|inbox|reminders?|payments?)\b/i;

export function classifyDetailsAnswer(message: string): DetailsAnswer | null {
  const text = (message ?? '').trim();
  if (!text) return null;
  if (RUN_AS_IS.test(text) || BARE_YES.test(text)) return { kind: 'run' };
  if (DECLINE.test(text)) return { kind: 'declined' };
  if (NOT_AN_ANSWER.test(text)) return null;
  if (text.split(/\s+/).length > 30) return null;
  if (NEW_REQUEST.test(text) || BUSINESS_OBJECT.test(text)) return null;
  const details = parseDetailsAnswer(text);
  if (!details.email && !details.website && !details.company && !details.location && details.note.split(/\s+/).length > 12) return null;
  return { kind: 'details', details };
}
