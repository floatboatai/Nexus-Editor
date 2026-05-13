/**
 * Fuzzy matching utilities for Nexus Editor.
 *
 * Implements a fzf-like scoring algorithm that:
 * - Matches non-contiguous characters (e.g. "hlg" → "Highlight")
 * - Scores by character continuity, word boundary bonuses, and match length
 * - Returns match indices for highlighting
 *
 * No external dependencies — keeps the bundle small.
 */

export interface FuzzyMatch {
  /** The matched item (original reference). */
  item: string;
  /** Total score (higher = better match). */
  score: number;
  /** Character indices in the item that matched the query (for highlighting). */
  indices: number[];
}

// Score bonuses — tuned to prefer word boundaries and contiguous runs.
const SCORE_CHARACTER = 1;
const SCORE_WORD_BOUNDARY = 80;
const SCORE_CONTIGUOUS_BONUS = 10;
const SCORE_PREFIX_BONUS = 60;
const PENALTY_GAP = -2;

function isWordBoundaryChar(ch: string): boolean {
  return /[\s\-_./\\]/.test(ch);
}

/**
 * Score a single candidate string against a query using fzf-like matching.
 * Returns null if the query cannot be matched.
 *
 * The algorithm walks through the candidate character by character, trying
 * to match each query character in order. When a query character matches,
 * it receives a score based on:
 * - Word boundary bonus (space, hyphen, underscore, dot, slash)
 * - Prefix bonus (match at the start of the candidate)
 * - Contiguous bonus (adjacent matched characters)
 * - Gap penalty (skipped characters between matches)
 */
function scoreCandidate(query: string, candidate: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();

  let qi = 0;
  let ci = 0;
  let score = 0;
  let lastMatchIdx = -2; // -2 so the first match isn't "contiguous"
  const indices: number[] = [];
  let matchCount = 0;

  while (qi < q.length && ci < c.length) {
    if (q[qi] === c[ci]) {
      indices.push(ci);
      matchCount++;

      // Word boundary bonus
      if (ci === 0 || isWordBoundaryChar(candidate[ci - 1])) {
        score += SCORE_WORD_BOUNDARY;
      }

      // Prefix bonus — first matched character at position 0
      if (ci === 0 && qi === 0) {
        score += SCORE_PREFIX_BONUS;
      }

      // Contiguous bonus
      if (ci === lastMatchIdx + 1) {
        score += SCORE_CONTIGUOUS_BONUS;
      }

      score += SCORE_CHARACTER;
      lastMatchIdx = ci;
      qi++;
    } else {
      // Gap penalty only between already-matched characters
      if (matchCount > 0) {
        score += PENALTY_GAP;
      }
    }
    ci++;
  }

  // Not all query characters were matched
  if (qi < q.length) return null;

  return { score, indices };
}

/**
 * Fuzzy-match a query against a list of candidate strings.
 * Returns results sorted by score (highest first), with match indices
 * for highlighting.
 *
 * @param query    The search query (e.g. "hlg").
 * @param items    Candidate strings to match against.
 * @returns        Array of FuzzyMatch sorted by descending score.
 */
export function fuzzyFilter(query: string, items: string[]): FuzzyMatch[] {
  if (!query) return [];

  const results: FuzzyMatch[] = [];

  for (const item of items) {
    const result = scoreCandidate(query, item);
    if (result !== null) {
      results.push({
        item,
        score: result.score,
        indices: result.indices,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Fuzzy-match a query against a single string.
 * Returns match result with score and indices, or null if no match.
 *
 * @param query     The search query.
 * @param candidate The string to match against.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  if (!query) return null;

  const result = scoreCandidate(query, candidate);
  if (result === null) return null;

  return {
    item: candidate,
    score: result.score,
    indices: result.indices,
  };
}
