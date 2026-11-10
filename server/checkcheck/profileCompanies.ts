/**
 * The companies of the Profile's role lines ("Current role: Co-Founder at Example Venture
 * Collective (EVC)", "Previous role: Co-Founder, Cherry Labs"), as names and as match tokens.
 * Used to recognise a company's own site (example.vc, evc.example, labs.example) so it can be
 * verified when the model links it and kept out of the citation chips. Pure.
 */
export function profileCompanies(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:Current|Previous|Past|Former)\s+Roles?\s*:?\s*(?:\*\*|__)?\s*:?\s*(.+?)\s*$/i.exec(line) ?? /^\s*(?:Currently|Previously)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const body = m[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '');
    const at = /\bat\s+(.+)$/i.exec(body);
    const comma = /,\s+([^,]+)$/.exec(body);
    const raw = (at?.[1] ?? comma?.[1] ?? '').trim().replace(/\.$/, '');
    if (!raw) continue;
    const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(raw);
    if (paren) {
      out.push(paren[1].trim(), paren[2].trim());
    } else out.push(raw);
  }
  return [...new Set(out.filter((c) => c.length >= 2 && c.length <= 60))];
}

/** Match tokens: the whole name squashed ("exampleventurecollective"), each word of 4+ letters, and the acronym. */
export function companyTokens(companies: string[]): string[] {
  const tokens = new Set<string>();
  const stop = new Set(['limited', 'ltd', 'inc', 'llc', 'plc', 'group', 'company', 'partners', 'capital', 'ventures', 'venture', 'collective', 'labs', 'technologies', 'technology', 'holdings']);
  for (const c of companies) {
    const words = c.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const whole = words.join('');
    if (whole.length >= 3) tokens.add(whole);
    for (const w of words) if (w.length >= 4 && !stop.has(w)) tokens.add(w);
    const acronym = words.filter((w) => !stop.has(w)).map((w) => w[0]).join('');
    if (acronym.length >= 3 && acronym.length <= 5) tokens.add(acronym);
  }
  return [...tokens];
}

/** Does this host belong to one of these companies? The host's brand equals a token, or a token of 5+ letters contains it. */
export function hostBelongsTo(host: string, tokens: string[]): boolean {
  const brand = host.toLowerCase().replace(/^www\./, '').split('.').filter((p) => !['com', 'co', 'uk', 'org', 'net', 'io', 'ai', 'vc', 'sg', 'app', 'group', 'us', 'de', 'fr'].includes(p))[0] ?? '';
  if (brand.length < 3) return false;
  return tokens.some((t) => t === brand || (brand.length >= 5 && t.includes(brand)) || (t.length >= 5 && brand.includes(t)));
}
