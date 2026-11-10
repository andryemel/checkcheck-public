/**
 * Reflow (founder 2026-09-30): a long paragraph is shown as short paragraphs of
 * roughly two to four lines with a gap between them, never breaking a sentence.
 * Pure Markdown-in, Markdown-out: only plain paragraphs are touched; headings,
 * lists, quotes and the bold "Label:" lines stay as they are.
 *
 * Line length is not known here, so the target is in characters: the card's
 * text-sm column holds about 60 characters per line, so a chunk aims at
 * 120–240 characters and takes whole sentences until the next would overflow.
 */
const MIN_CHUNK = 120;
const MAX_CHUNK = 240;

// A sentence ends at . ! or ? followed by a space and an opening character — except after
// common abbreviations and initials ("Inc.", "Ltd.", "U.S.", "J. Smith").
const ABBREVIATIONS = /\b(?:Inc|Ltd|Co|Corp|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|approx|No|U\.S|U\.K|e\.g|i\.e)\.$/i;
const SENTENCE_END = /[.!?]["')\]]?(?=\s+(?=["'([]?[A-Z0-9]))/g;

export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index! + match[0].length;
    const candidate = text.slice(start, end).trim();
    if (ABBREVIATIONS.test(candidate) || /\b[A-Z]\.$/.test(candidate)) continue;
    out.push(candidate);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

export function chunkSentences(sentences: string[], min = MIN_CHUNK, max = MAX_CHUNK): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length >= min && current.length + 1 + sentence.length > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`;
    }
  }
  if (current) chunks.push(current);
  // A short tail (one line) reads better joined to its neighbour than left hanging.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < min / 2) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${tail}`;
  }
  return chunks;
}

const BLOCK_START = /^\s*(?:[-*+]\s|#{1,6}\s|>|\d+[.)]\s|\|)/;

function isPlainParagraph(block: string): boolean {
  return !block.split('\n').some((line) => BLOCK_START.test(line));
}

export function reflowParagraphs(markdown: string): string {
  return markdown
    .split(/\n[ \t]*\n/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed || !isPlainParagraph(trimmed)) return trimmed;
      // A bold "Label:" line block (Currently: …) is a set of lines, not prose: keep it.
      if (trimmed.split('\n').every((line) => /^(\*\*|__)?[^:]{1,30}:/.test(line))) return trimmed;
      const chunks = chunkSentences(splitSentences(trimmed));
      return chunks.join('\n\n');
    })
    .filter((block) => block !== '')
    .join('\n\n');
}
