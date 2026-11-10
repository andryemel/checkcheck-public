/**
 * CheckCheck — deterministic purpose screen, run BEFORE any network call
 * (docs/CHECKCHECK_PLAN.md §2, §3 decision C-2; prompt rule 7 is the backstop).
 *
 * The product researches a BUSINESS counterparty or prepares a meeting. The
 * purposes below make a research product a consumer-reporting / screening
 * service (FCRA, California ICRAA, EU AI Act Annex III) or reach into a
 * person's private life, so a request that states one is refused with a typed
 * reason and nothing is searched. The words are read from the USER'S request
 * only — never from a model argument, never from the subject's name.
 *
 * Kept narrow on purpose: "hire this contractor" is the supplier angle and is
 * fine; "hire him as an employee" is employment screening and is not.
 */

export type RefusalReason =
  | 'employment_screening'
  | 'tenant_screening'
  | 'credit_or_insurance_eligibility'
  | 'litigation_targeting'
  | 'criminal_history'
  | 'personal_life';

export interface PurposeScreenResult {
  refused: boolean;
  reason: RefusalReason | null;
}

/** Plain-words explanation shown to the user for each refusal (fixed copy, never model text). */
export const REFUSAL_COPY: Record<RefusalReason, string> = {
  employment_screening:
    "CheckCheck doesn't screen people for a job. Checks used for hiring decisions are regulated background checks, which this isn't.",
  tenant_screening:
    "CheckCheck doesn't screen tenants. That is a regulated background check, which this isn't.",
  credit_or_insurance_eligibility:
    "CheckCheck can't assess a person's credit, finances or insurance eligibility. It can check a company's public filings.",
  litigation_targeting:
    "CheckCheck doesn't research people to decide whether to sue them.",
  criminal_history:
    "CheckCheck doesn't look up criminal history. It stays with a person's professional footprint and a company's public record.",
  personal_life:
    "CheckCheck stays with the professional side: no home address, family, relationships, health or beliefs.",
};

const RULES: Array<{ reason: RefusalReason; patterns: RegExp[] }> = [
  {
    reason: 'employment_screening',
    patterns: [
      /\b(as|for) (an? )?(employee|staff member|member of staff|full[- ]time|part[- ]time|permanent) (role|position|job)?/i,
      /\b(employ|employing|employment|payroll|recruit|recruiting|recruitment|job (candidate|applicant|application|offer|interview)|candidate for (a|the) (job|role|position)|applicant)\b/i,
      /\b(pre[- ]?employment|background check|background[- ]screen)/i,
      /\bhire (him|her|them) as (an? )?(employee|staff)/i,
    ],
  },
  {
    reason: 'tenant_screening',
    patterns: [/\b(tenant|tenancy|renting (my|our|the) (flat|house|room|property|apartment)|let (my|our) (flat|house|property)|landlord check|rental application)\b/i],
  },
  {
    reason: 'credit_or_insurance_eligibility',
    patterns: [
      /\b(credit (check|score|rating|report|worthiness|limit)|creditworth|lend (him|her|them)|give (him|her|them) (a )?(loan|credit)|mortgage|insur(e|ance) (him|her|them|eligib))/i,
    ],
  },
  {
    reason: 'litigation_targeting',
    patterns: [/\b(worth suing|can i sue|should i sue|sue (him|her|them)|take (him|her|them) to court|serve (him|her|them))\b/i],
  },
  {
    reason: 'criminal_history',
    patterns: [/\b(criminal (record|history|background|check)|police record|arrest(ed|s)?\b|convict(ed|ion|ions)|sex offender|prison record|dbs check)/i],
  },
  {
    reason: 'personal_life',
    patterns: [
      /\b(home address|where (he|she|they) (live|lives)|find (his|her|their) (home|house|address)|spouse|wife|husband|girlfriend|boyfriend|dating|romantic|ex[- ](wife|husband|partner)|kids|children|religion|religious|sexuality|sexual orientation|health (condition|record|issues)|medical (record|history)|political (views|affiliation))\b/i,
    ],
  },
];

export function screenPurpose(userRequest: string): PurposeScreenResult {
  const text = (userRequest ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { refused: false, reason: null };
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { refused: true, reason: rule.reason };
    }
  }
  return { refused: false, reason: null };
}
