/**
 * Numbers semibold (founder 2026-09-30): every numeric token in the prose — an
 * amount with its currency and unit ($170 million, £1.2bn), a count (15,000), a
 * percentage (25%), a year or a day (2 December 2025 → the 2 and the 2025) — is
 * wrapped in `**`. Pure Markdown-in, Markdown-out. Left alone: anything inside a
 * link (label or URL), inside existing bold, inside code, and a heading line.
 */
const SEGMENTS = /(\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g;
// A digit joined to letters or by a hyphen, slash or colon (GPT4, INV-26-0144, 12/02/2025, 09:30) is an identifier, not a figure.
const NUMBER = /(^|[^\p{L}\p{N}_$£€.\-/:])((?:[$£€]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|thousand|bn|mn|m|k|%|percent|pc))?)(?=$|[^\p{L}\p{N}_%\-/:])/giu;

function boldSegment(text: string): string {
  return text.replace(NUMBER, (_whole, before: string, number: string) => `${before}**${number}**`);
}

export function boldNumbers(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return line;
      return line
        .split(SEGMENTS)
        .map((segment, i) => (i % 2 === 1 ? segment : boldSegment(segment)))
        .join('');
    })
    .join('\n');
}
