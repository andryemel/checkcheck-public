/**
 * The pages a run retrieved, read from the app's own "Sources checked on …" list at the end
 * of the stored text (the card never shows that list; founder 2026-09-30: sources are pills
 * with a favicon and the outlet's name, and outlet names in the prose link to these pages).
 * Pure.
 */
export interface SourcePage {
  host: string;
  url: string;
  how: 'record' | 'page read' | 'search result';
}

const LINE = /^-\s+\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*\((record|page read|search result)\)\s*$/;

export function parseSourcePages(briefingText: string): SourcePage[] {
  const at = briefingText.search(/\*\*Sources checked on [^*]+\*\*/);
  if (at < 0) return [];
  const out: SourcePage[] = [];
  const seen = new Set<string>();
  for (const line of briefingText.slice(at).split('\n')) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const host = hostOf(m[2]) ?? m[1].toLowerCase();
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ host, url: m[2], how: m[3] as SourcePage['how'] });
  }
  return out;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The registrable brand token of a host: "techfundingnews.com" → "techfundingnews", "theventurelens.substack.com" → "theventurelens". */
export function brandToken(host: string): string {
  const parts = host.split('.').filter(Boolean);
  const generic = new Set(['com', 'co', 'uk', 'org', 'net', 'io', 'ai', 'app', 'vc', 'gov', 'sg', 'de', 'fr', 'es', 'it', 'nl', 'eu', 'us', 'info', 'news', 'media']);
  const sld = parts.filter((p) => !generic.has(p));
  // a hosted blog keeps its own name ("theventurelens" on substack.com)
  return (sld[0] ?? parts[0] ?? host).replace(/[^a-z0-9]/g, '');
}

/** Well-known outlets and platforms by host; anything else is named from the text or the host. */
export const KNOWN_NAMES: Record<string, string> = {
  'bloomberg.com': 'Bloomberg', 'ft.com': 'Financial Times', 'thenextweb.com': 'The Next Web', 'techcrunch.com': 'TechCrunch',
  'businessinsider.com': 'Business Insider', 'bisnow.com': 'Bisnow', 'techfundingnews.com': 'Tech Funding News', 'forbes.com': 'Forbes',
  'reuters.com': 'Reuters', 'theguardian.com': 'The Guardian', 'bbc.co.uk': 'BBC', 'bbc.com': 'BBC', 'wsj.com': 'Wall Street Journal',
  'nytimes.com': 'New York Times', 'economictimes.indiatimes.com': 'The Economic Times', 'fintechnews.sg': 'Fintech News Singapore',
  'natlawreview.com': 'National Law Review', 'pulse2.com': 'Pulse 2.0', 'crunchbase.com': 'Crunchbase', 'pitchbook.com': 'PitchBook',
  'wanderlog.com': 'Wanderlog', 'tripadvisor.com': 'Tripadvisor', 'trustpilot.com': 'Trustpilot', 'yelp.com': 'Yelp', 'medium.com': 'Medium',
  'substack.com': 'Substack', 'youtube.com': 'YouTube', 'podcasts.apple.com': 'Apple Podcasts', 'open.spotify.com': 'Spotify',
  'linkedin.com': 'LinkedIn', 'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X', 'facebook.com': 'Facebook', 'github.com': 'GitHub',
  'find-and-update.company-information.service.gov.uk': 'Companies House', 'grokipedia.com': 'Grokipedia', 'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia', 'sifted.eu': 'Sifted', 'uktech.news': 'UKTN', 'startupfortune.com': 'Startup Fortune', 'signal.nfx.com': 'NFX Signal',
  'capboard.io': 'Capboard', 'producthunt.com': 'Product Hunt', 'theorg.com': 'The Org', 'glassdoor.com': 'Glassdoor', 'indeed.com': 'Indeed',
};

/** Google's favicon service, as the fast header already uses for the site icon. */
export function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/** Names the text uses for outlets: italic or bold runs, up to five words. */
export function namesInText(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/(?<!\*)\*{1,2}([A-Z][^*\n]{1,60}?)\*{1,2}(?!\*)/g)) {
    const name = m[1].replace(/:$/, '').trim();
    if (name.split(/\s+/).length <= 5 && !/^\d/.test(name)) out.add(name);
  }
  return [...out];
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A display name for a source host: the text's own name for it, a known name, else the host. */
export function sourceName(host: string, textNames: string[]): string {
  if (KNOWN_NAMES[host]) return KNOWN_NAMES[host];
  const token = brandToken(host);
  // A hosted blog ("theventurelens.substack.com") is named by the text before its platform.
  const fromText = textNames.find((n) => normalise(n) === token || (token.length >= 6 && normalise(n).includes(token)));
  if (fromText) return fromText;
  const parent = KNOWN_NAMES[host.replace(/^[^.]+\./, '')];
  return parent ?? host;
}

/** Text names that denote a retrieved outlet → that page. "Tech Funding News" → techfundingnews.com. */
export function outletLinks(textNames: string[], sources: SourcePage[]): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  for (const name of textNames) {
    const key = normalise(name);
    if (key.length < 4) continue;
    const page = sources.find((s) => brandToken(s.host) === key || normalise(KNOWN_NAMES[s.host] ?? '') === key);
    if (page) out.push({ name, url: page.url });
  }
  return out;
}

/**
 * Citations become inline chips (founder 2026-09-30): a Markdown link whose page the run
 * retrieved and that is not the subject's own site or profile is rewritten as
 * `[Short name](url "source")`, which the shared Markdown renderer shows as a small
 * favicon + name chip beside the sentence. Entity links (companies, people, the subject's
 * site, LinkedIn, Google searches) are left as they are.
 */
export function chipifySourceLinks(markdown: string, sources: SourcePage[], identityHosts: string[], textNames: string[], entityNames: string[] = []): string {
  const sourceHosts = new Map(sources.map((s) => [s.host, s] as const));
  const identity = new Set(identityHosts.map((h) => h.toLowerCase().replace(/^www\./, '')));
  const entities = new Set(entityNames.map((n) => n.trim().toLowerCase()));
  return markdown.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)/g, (whole, label: string, url: string, offset: number, all: string) => {
    // "Official registry record: [Companies House](…)": the link IS the value of a label line — a chip would leave
    // "Official registry record:." behind (2026-10-02). It stays inline.
    const lineStart = all.lastIndexOf('\n', offset - 1) + 1;
    if (/:\s*$/.test(all.slice(lineStart, offset))) return whole;
    const host = hostOf(url);
    if (!host || identity.has(host) || host === 'google.com') return whole;
    // "Acme", "Example Corp": a name the text links as an entity stays a name (a chip would pull it out of the sentence).
    if (entities.has(label.replace(/\*\*|__|\*/g, '').trim().toLowerCase())) return whole;
    // "company number [16493360](register)": the link text is a FACT, not the source's name — a chip would carry the
    // number out of the sentence into the Sources pill ("company number." on the card, 2026-10-02). It stays inline.
    // A short label with a digit is a value ("16493360", "$17 million", "3.6 / 5"); a long one is a headline citation.
    if (/\d/.test(label) && label.trim().split(/\s+/).length <= 4) return whole;
    const isSource = sourceHosts.has(host) || [...sourceHosts.keys()].some((h) => host.endsWith(`.${h}`) || h.endsWith(`.${host}`));
    if (!isSource) return whole;
    const clean = label.replace(/\*\*|__|\*/g, '').trim();
    const name = clean.length > 28 || /^https?:/.test(clean) ? sourceName(host, textNames) : clean;
    return `[${name}](${url} "source")`;
  });
}
