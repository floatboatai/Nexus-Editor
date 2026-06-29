/**
 * Fuzzy (subsequence) matcher with positional scoring.
 *
 * Unlike the exact / regex search in this package — which finds *contiguous*
 * runs in a document — fuzzy matching asks whether the query characters appear
 * in `target` in order but not necessarily adjacent ("gcl" matches "gamma
 * cluster"). It returns a score so callers can rank candidates (slash menus,
 * command palettes, file pickers) best-first.
 *
 * Scoring is a single forward dynamic-programming pass: `dp[i][j]` is the best
 * total score for aligning the first `i + 1` query characters with the i-th
 * landing on target position `j`. The per-position gap term is linear in `j`,
 * so the running max over earlier landing positions collapses to O(1) — the
 * whole pass is O(query.length * target.length) with no backtracking blow-up.
 */

export interface FuzzyMatch {
  /**
   * Total score. Higher is a better match. Always >= the base match score when
   * matched. The exact magnitude is an implementation detail — only the
   * relative ordering is meaningful, so callers should sort rather than
   * threshold on a constant.
   */
  score: number;
  /**
   * Indices into `target` (not the query) of every matched character, in
   * ascending order. Use these to highlight the matched glyphs.
   */
  positions: number[];
}

export interface FuzzyMatchOptions {
  /**
   * Match case-sensitively. Defaults to false — `query` and `target` are
   * compared lower-cased.
   */
  caseSensitive?: boolean;
}

export interface FuzzyItemResult<T> {
  item: T;
  score: number;
  positions: number[];
}

export interface FuzzyFilterOptions<T> extends FuzzyMatchOptions {
  /**
   * Extract the string to match against from each item. Defaults to using the
   * item itself (so `T` must be `string`).
   */
  key?: (item: T) => string;
  /**
   * Cap the number of results returned, after sorting. Negative or zero means
   * "no limit".
   */
  limit?: number;
}

// Scoring weights. Tuned so that, in order of importance:
//   1. a match at the start of the target beats one in the middle,
//   2. consecutive matched characters beat scattered ones,
//   3. matches right after a word boundary (space, -, _, /, camelCase hump)
//      beat matches mid-word.
const SCORE_MATCH = 16;
const BONUS_CONSECUTIVE = 18;
const BONUS_START = 12;
const BONUS_WORD_BOUNDARY = 10;
const PENALTY_LEADING_GAP = 3; // per skipped char before the first match
const PENALTY_GAP = 1; // per skipped char between matches

const NEG_INF = -Infinity;

function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  const prev = target.charCodeAt(index - 1);
  // space, tab, newline, -, _ count as separators.
  if (prev === 32 || prev === 9 || prev === 10 || prev === 45 || prev === 95) {
    return true;
  }
  // /, ., : path/segment separators.
  if (prev === 47 || prev === 46 || prev === 58) return true;
  // camelCase / digit-to-upper hump. Use the original-cased characters here
  // regardless of caseSensitive.
  const prevCh = target[index - 1];
  const curCh = target[index];
  if (prevCh >= "a" && prevCh <= "z" && curCh >= "A" && curCh <= "Z") {
    return true;
  }
  if (prevCh >= "0" && prevCh <= "9" && curCh >= "A" && curCh <= "Z") {
    return true;
  }
  return false;
}

function charBase(original: string, j: number): number {
  let score = SCORE_MATCH;
  if (j === 0) score += BONUS_START;
  else if (isWordBoundary(original, j)) score += BONUS_WORD_BOUNDARY;
  return score;
}

/**
 * Score a single (target, query) pair. Returns null when `query` is not a
 * subsequence of `target`. An empty query matches everything with score 0 and
 * no highlighted positions.
 */
export function fuzzyMatch(
  target: string,
  query: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatch | null {
  if (query === "") {
    return { score: 0, positions: [] };
  }
  const n = target.length;
  const m = query.length;
  if (n === 0 || m > n) return null;

  const haystack = options.caseSensitive ? target : target.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();

  // dp[j] holds the best score for the query char currently being processed,
  // landing at target position j (NEG_INF if char[j] can't be that position).
  // back[i][j] records the previous landing position chosen at (i, j), so the
  // alignment can be reconstructed afterwards.
  let prev = new Array<number>(n).fill(NEG_INF);
  const back: Int32Array[] = [];
  for (let i = 0; i < m; i++) back.push(new Int32Array(n).fill(-1));

  // First query character: leading gap penalty grows with the start offset.
  for (let j = 0; j < n; j++) {
    if (haystack[j] !== needle[0]) continue;
    prev[j] = charBase(target, j) - PENALTY_LEADING_GAP * j;
    back[0][j] = -1;
  }

  for (let i = 1; i < m; i++) {
    const cur = new Array<number>(n).fill(NEG_INF);
    // Running max of g(k) = prev[k] + PENALTY_GAP * k over all earlier k < j.
    // The gap term for landing at j is g(k) - PENALTY_GAP * (j - 1).
    let bestG = NEG_INF;
    let bestGk = -1;

    for (let j = 0; j < n; j++) {
      // Fold position k = j - 1 into the running max before using it (k < j).
      if (j - 1 >= 0 && prev[j - 1] > NEG_INF) {
        const g = prev[j - 1] + PENALTY_GAP * (j - 1);
        if (g > bestG) {
          bestG = g;
          bestGk = j - 1;
        }
      }

      if (haystack[j] !== needle[i]) continue;
      if (bestGk < 0) continue; // no viable predecessor yet

      // Gap option: best earlier landing minus the intervening-gap penalty.
      let total = bestG - PENALTY_GAP * (j - 1);
      let chosenK = bestGk;

      // Consecutive option: predecessor at j - 1 with the run bonus, no gap.
      if (j - 1 >= 0 && prev[j - 1] > NEG_INF) {
        const consecutive = prev[j - 1] + BONUS_CONSECUTIVE;
        if (consecutive > total) {
          total = consecutive;
          chosenK = j - 1;
        }
      }

      cur[j] = charBase(target, j) + total;
      back[i][j] = chosenK;
    }

    prev = cur;
  }

  // Best final landing for the last query character.
  let bestJ = -1;
  let bestScore = NEG_INF;
  for (let j = 0; j < n; j++) {
    if (prev[j] > bestScore) {
      bestScore = prev[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;

  const positions = new Array<number>(m);
  let j = bestJ;
  for (let i = m - 1; i >= 0; i--) {
    positions[i] = j;
    j = back[i][j];
  }

  return { score: bestScore, positions };
}

/**
 * Rank `items` by fuzzy match against `query`, best first. Non-matching items
 * are dropped. An empty query returns every item in original order with score
 * 0 (the "menu just opened" case — callers shouldn't reorder on no input).
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  options: FuzzyFilterOptions<T> = {}
): FuzzyItemResult<T>[] {
  const key = options.key ?? ((item: T) => item as unknown as string);

  if (query === "") {
    return items.map((item) => ({ item, score: 0, positions: [] }));
  }

  const scored: Array<FuzzyItemResult<T> & { index: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const match = fuzzyMatch(key(item), query, options);
    if (match === null) continue;
    scored.push({ item, score: match.score, positions: match.positions, index: i });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable tiebreak: original order so equal-score results stay deterministic.
    return a.index - b.index;
  });

  const limit = options.limit;
  const sliced = limit !== undefined && limit > 0 ? scored.slice(0, limit) : scored;
  return sliced.map(({ item, score, positions }) => ({ item, score, positions }));
}
