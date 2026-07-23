/**
 * Fuzzy subsequence matching with scoring, inspired by fzf.
 *
 * A fuzzy match is a subsequence: every character of `query` appears in
 * the source text in order, but not necessarily contiguously.  Each
 * match receives a score that rewards consecutive character hits, word
 * boundaries, and penalises gaps — letting callers rank results.
 *
 * Matching is code-point aware: astral-plane characters (emoji, CJK
 * extension blocks, musical symbols) are compared as whole code points,
 * so a query can never latch onto half of a surrogate pair.  Offsets in
 * the returned matches stay in UTF-16 code units, because editor
 * selection coordinates (CodeMirror, Monaco, textarea) use the same
 * unit — callers can feed `from`/`to`/`positions` straight back into
 * selection and highlight APIs.
 */

export interface FuzzyMatch {
  /** Start offset of the match window (first matched character). */
  from: number;
  /** End offset of the match window (exclusive — past the last matched character). */
  to: number;
  /** The full text spanned by the match window, including gaps. */
  text: string;
  /** Match quality score — higher is better. */
  score: number;
  /** Offsets of every query character within the source text. */
  positions: number[];
}

export interface FuzzySearchOptions {
  caseSensitive?: boolean;
  /**
   * Maximum gap (unmatched characters) between two consecutive matched
   * characters.  Prevents a short query from spanning an entire
   * document.  Default 64.
   */
  maxGap?: number;
}

/** Punctuation / whitespace / symbol characters that delimit words. */
const WORD_BOUNDARY = /[\s\p{P}\p{S}_\-]/u;

/**
 * Length in UTF-16 code units of the code point starting at `index`.
 * Lone surrogates count as 1 so iteration always terminates.
 */
function charSize(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
}

/** The whole code point starting at `index` (1 or 2 code units). */
function charAt(text: string, index: number): string {
  return text.slice(index, index + charSize(text, index));
}

/** Number of code points in `text` between `from` (inclusive) and `to` (exclusive). */
function countCodePoints(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i += charSize(text, i)) count++;
  return count;
}

function charEquals(a: string, b: string, caseSensitive: boolean): boolean {
  return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  let start = index - 1;
  const code = text.charCodeAt(start);
  // Step back over a low surrogate so the boundary test sees the whole
  // astral character — emoji count as symbols and therefore delimit words.
  if (
    code >= 0xdc00 &&
    code <= 0xdfff &&
    start > 0 &&
    text.charCodeAt(start - 1) >= 0xd800 &&
    text.charCodeAt(start - 1) <= 0xdbff
  ) {
    start -= 1;
  }
  return WORD_BOUNDARY.test(text.slice(start, index));
}

/**
 * Score a set of matched positions within `text`.  The model rewards:
 * - Word-boundary starts (+10)
 * - Consecutive character runs (+15 × run length, stacking)
 * - Compact windows (gap penalty −3 per skipped character)
 */
function scorePositions(positions: number[], text: string): number {
  if (positions.length === 0) return 0;

  let score = 0;
  let consecutive = 0;

  for (let i = 0; i < positions.length; i++) {
    score += 1;

    if (isWordBoundary(text, positions[i])) {
      score += 10;
    }

    if (i > 0) {
      const prevEnd = positions[i - 1] + charSize(text, positions[i - 1]);
      if (positions[i] === prevEnd) {
        consecutive++;
        score += 15 * consecutive;
      } else {
        consecutive = 0;
        // Gaps are priced in code points, not code units — an astral
        // character in the gap must not cost double.
        score -= countCodePoints(text, prevEnd, positions[i]) * 3;
      }
    }
  }

  return Math.max(0, score);
}

/**
 * Greedy subsequence match: walk `text` forward from `startIndex`,
 * consuming query characters in order.  Returns matched offsets or
 * `null` when the query is exhausted before the text ends, or when a
 * gap exceeds `maxGap`.
 *
 * Both cursors advance by whole code points; `maxGap` is measured in
 * code points as well, keeping the limit meaningful for mixed
 * BMP / astral-plane text.
 */
function greedyMatch(
  text: string,
  query: string,
  startIndex: number,
  maxGap: number,
  caseSensitive: boolean
): number[] | null {
  const positions: number[] = [];
  let textIndex = startIndex;
  let queryIndex = 0;
  let skipped = 0;

  while (queryIndex < query.length && textIndex < text.length) {
    const tChar = charAt(text, textIndex);
    const qChar = charAt(query, queryIndex);
    if (charEquals(tChar, qChar, caseSensitive)) {
      if (positions.length > 0 && skipped > maxGap) return null;
      positions.push(textIndex);
      skipped = 0;
      queryIndex += qChar.length;
    } else {
      skipped++;
    }
    textIndex += tChar.length;
  }

  return queryIndex === query.length ? positions : null;
}

function buildFuzzyMatch(text: string, positions: number[]): FuzzyMatch {
  const from = positions[0];
  const last = positions[positions.length - 1];
  const to = last + charSize(text, last);
  return {
    from,
    to,
    text: text.slice(from, to),
    score: scorePositions(positions, text),
    positions: [...positions]
  };
}

/**
 * Find the highest-scoring fuzzy match of `query` within `text`.
 *
 * Every starting position whose first character equals `query[0]` is
 * tried; the greedy subsequence matcher resolves the rest.  Returns
 * `null` when no subsequence match exists within the `maxGap` window.
 */
export function fuzzyMatch(
  text: string,
  query: string,
  options: FuzzySearchOptions = {}
): FuzzyMatch | null {
  if (!query || query.length > text.length) return null;

  const caseSensitive = options.caseSensitive ?? false;
  const maxGap = options.maxGap ?? 64;
  const queryHead = charAt(query, 0);

  let best: FuzzyMatch | null = null;

  for (let start = 0; start <= text.length - query.length; start += charSize(text, start)) {
    if (!charEquals(charAt(text, start), queryHead, caseSensitive)) continue;

    const positions = greedyMatch(text, query, start, maxGap, caseSensitive);
    if (!positions) continue;

    const candidate = buildFuzzyMatch(text, positions);
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Find all non-overlapping fuzzy matches of `query` in `doc`, scanning
 * left to right.  After a match is found the cursor jumps past the
 * match window, so every returned match is disjoint.
 */
export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzySearchOptions = {}
): FuzzyMatch[] {
  if (!query || query.length > doc.length) return [];

  const caseSensitive = options.caseSensitive ?? false;
  const maxGap = options.maxGap ?? 64;
  const queryHead = charAt(query, 0);

  const matches: FuzzyMatch[] = [];
  let cursor = 0;

  while (cursor <= doc.length - query.length) {
    if (!charEquals(charAt(doc, cursor), queryHead, caseSensitive)) {
      cursor += charSize(doc, cursor);
      continue;
    }

    const positions = greedyMatch(doc, query, cursor, maxGap, caseSensitive);
    if (!positions) {
      cursor += charSize(doc, cursor);
      continue;
    }

    matches.push(buildFuzzyMatch(doc, positions));
    cursor = positions[positions.length - 1] + charSize(doc, positions[positions.length - 1]);
  }

  return matches;
}
