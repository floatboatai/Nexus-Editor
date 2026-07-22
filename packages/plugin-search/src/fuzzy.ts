/**
 * Fuzzy subsequence matching with scoring, inspired by fzf.
 *
 * A fuzzy match is a subsequence: every character of `query` appears in
 * the source text in order, but not necessarily contiguously.  Each
 * match receives a score that rewards consecutive character hits, word
 * boundaries, and penalises gaps — letting callers rank results.
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

function charEquals(a: string, b: string, caseSensitive: boolean): boolean {
  return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return WORD_BOUNDARY.test(prev);
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

    if (i > 0 && positions[i] === positions[i - 1] + 1) {
      consecutive++;
      score += 15 * consecutive;
    } else {
      consecutive = 0;
      if (i > 0) {
        score -= (positions[i] - positions[i - 1] - 1) * 3;
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
  let lastMatchPos = -1;

  while (queryIndex < query.length && textIndex < text.length) {
    if (charEquals(text[textIndex], query[queryIndex], caseSensitive)) {
      if (lastMatchPos >= 0) {
        const gap = textIndex - lastMatchPos - 1;
        if (gap > maxGap) return null;
      }
      positions.push(textIndex);
      lastMatchPos = textIndex;
      queryIndex++;
    }
    textIndex++;
  }

  return queryIndex === query.length ? positions : null;
}

function buildFuzzyMatch(text: string, positions: number[]): FuzzyMatch {
  const from = positions[0];
  const to = positions[positions.length - 1] + 1;
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

  let best: FuzzyMatch | null = null;

  for (let start = 0; start <= text.length - query.length; start++) {
    if (!charEquals(text[start], query[0], caseSensitive)) continue;

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

  const matches: FuzzyMatch[] = [];
  let cursor = 0;

  while (cursor <= doc.length - query.length) {
    if (!charEquals(doc[cursor], query[0], caseSensitive)) {
      cursor++;
      continue;
    }

    const positions = greedyMatch(doc, query, cursor, maxGap, caseSensitive);
    if (!positions) {
      cursor++;
      continue;
    }

    matches.push(buildFuzzyMatch(doc, positions));
    cursor = positions[positions.length - 1] + 1;
  }

  return matches;
}
