/**
 * Citation chips live in a row UNDER the paragraph, never inside it (founder 2026-09-30).
 * A block's `[Name](url "source")` links — the server's placement at the end of the
 * paragraph and the model's own inline citations — are lifted out here; the paragraph
 * renders clean and the chips render as a row after it.
 */
export interface SourceChip {
  name: string;
  url: string;
  host: string;
}

const SOURCE_LINK = /\s*\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\s+"source"\)/g;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function extractSourceChips(block: string): { text: string; chips: SourceChip[] } {
  const chips: SourceChip[] = [];
  const seen = new Set<string>();
  const text = block
    .replace(SOURCE_LINK, (_whole, name: string, url: string) => {
      const host = hostOf(url);
      const key = url.replace(/[?#].*$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        chips.push({ name: name.trim(), url, host });
      }
      return '';
    })
    // a citation that sat in brackets or after a comma leaves "( )" or " ," behind
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return { text, chips };
}
