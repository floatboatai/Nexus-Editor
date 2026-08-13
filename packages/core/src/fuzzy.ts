/**
 * fzf-class fuzzy subsequence matcher.
 *
 * Matches `query` as an *ordered subsequence* of `text` (not a contiguous
 * substring) and scores each alignment with positional bonuses — word
 * boundaries, camelCase transitions, and consecutive runs — plus penalties
 * for gaps between matches and leading unmatched characters.
 *
 * The optimal alignment is found with an O(m·n) dynamic program that
 * backtracks to recover the matched character offsets. That "backtracking
 * matcher" is exactly what ROADMAP.md #17 ("evaluate fzf-class algorithm,
 * needs a backtracking matcher") asks for.
 *
 * Pure and framework-free so both `core` (slash-menu ranking) and the search
 * plugin can share it without pulling in a dependency.
 */

export interface FuzzyMatchResult {
  /** Whether `query` occurs as a subsequence of `text`. */
  matched: boolean;
  /** Higher is a better match. Meaningful only when `matched` is true. */
  score: number;
  /** Indices into `text` of the matched characters, ascending. Empty when unmatched. */
  positions: number[];
}

export interface FuzzyOptions {
  /** When true, matching is case-sensitive. Default: false. */
  caseSensitive?: boolean;
}

const BONUS_BOUNDARY = 12;
const BONUS_NON_WORD = 6;
const BONUS_CAMEL = 8;
const BONUS_CONSECUTIVE = 12;
const GAP_PENALTY = 2;
const LEADING_PENALTY = 3;

const SEPARATORS = new Set([
  " ", "\t", "\n",
  "/", "\\", "_", "-", ".", ":", ";", ",", "#", "@", "&",
  "(", ")", "[", "]", "{", "}", "<", ">", "\"", "'", "=", "+", "|",
]);

function isLower(ch: string): boolean {
  return ch >= "a" && ch <= "z";
}

function isUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isAlnum(ch: string): boolean {
  return isLower(ch) || isUpper(ch) || (ch >= "0" && ch <= "9");
}

function charsEqual(a: string, b: string, caseSensitive: boolean): boolean {
  return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Bonus for matching at `idx` based on the character before it. Consecutive
 * matches are scored separately by the DP, so this intentionally omits that
 * term.
 */
function positionalBonus(text: string, idx: number): number {
  if (idx === 0) {
    return BONUS_BOUNDARY;
  }
  const prev = text[idx - 1];
  if (SEPARATORS.has(prev)) {
    return BONUS_BOUNDARY;
  }
  if (!isAlnum(prev)) {
    return BONUS_NON_WORD;
  }
  if (isLower(prev) && isUpper(text[idx])) {
    return BONUS_CAMEL;
  }
  return 0;
}

const NEG = -Infinity;

export function fuzzyMatch(query: string, text: string, options: FuzzyOptions = {}): FuzzyMatchResult {
  const caseSensitive = options.caseSensitive ?? false;
  const m = query.length;
  const n = text.length;

  if (m === 0 || n === 0) {
    return { matched: false, score: 0, positions: [] };
  }

  const stride = n + 1;
  // C[i][j] — best score matching the first i query chars, ending with
  // text[j-1] matched.
  const C = new Float64Array((m + 1) * stride);
  // prevC[i][j] — the j-index (1-based) of the previous matched char, or -1.
  const prevC = new Int32Array((m + 1) * stride);
  // D[i][j] — best score matching the first i query chars within text[0..j).
  // Used to allow gaps between matched characters.
  const D = new Float64Array((m + 1) * stride);
  const prevD = new Int32Array((m + 1) * stride).fill(-1);

  // C[0][*] is unreachable (no chars matched but the run "ends matched").
  for (let j = 0; j <= n; j++) {
    C[j] = NEG;
  }
  // D[0][j] = 0: zero query chars matched trivially.
  for (let j = 0; j <= n; j++) {
    D[j] = 0;
  }
  // C[i][0] and D[i][0] are unreachable for i >= 1: a non-empty query prefix
  // cannot be "matched" before the first text character. Float64Array zeroes
  // these slots by default, which would make C[i][0] === 0 (a tempting but
  // invalid score); force them to NEG so backtracking/continuation see the
  // real "no match yet" sentinel.
  for (let i = 1; i <= m; i++) {
    C[i * stride] = NEG;
    D[i * stride] = NEG;
  }

  for (let i = 1; i <= m; i++) {
    const q = query[i - 1];
    for (let j = 1; j <= n; j++) {
      const here = i * stride + j;
      const diag = (i - 1) * stride + (j - 1);
      const left = i * stride + (j - 1);

      let cell = NEG;
      let pcell = -1;

      if (charsEqual(text[j - 1], q, caseSensitive)) {
        const bonus = positionalBonus(text, j - 1);

        // Candidate A: the previous match was at j-2 (consecutive run).
        const candA = C[diag] !== NEG ? C[diag] + BONUS_CONSECUTIVE : NEG;
        // Candidate B: the previous match was earlier (a gap exists).
        let candB = D[diag];
        if (candB !== NEG) {
          const prevJ = prevD[diag];
          if (prevJ >= 0) {
            const gap = (j - 1) - prevJ;
            if (gap > 0) {
              candB -= GAP_PENALTY * gap;
            }
          }
        }

        if (candA !== NEG || candB !== NEG) {
          if (candA >= candB) {
            cell = bonus + candA;
            pcell = j - 1;
          } else {
            cell = bonus + candB;
            pcell = prevD[diag];
          }
        }

        // Penalize characters before the very first matched character. The
        // first match is tagged with a *self-reference* (pcell === j) so that
        // backtracking stops at the correct offset instead of losing it when
        // the gap path propagates prevD leftwards.
        if (i === 1) {
          cell -= LEADING_PENALTY * (j - 1);
          pcell = j;
        }
      }

      C[here] = cell;
      prevC[here] = pcell;

      // D[i][j] = max(C[i][j], D[i][j-1]). When a match lands at column j it
      // becomes the new "last matched position" (prevD = j); extending through
      // a gap carries that position forward unchanged. Using `j` here (not
      // `pcell`) is what lets backtracking recover every matched character,
      // including ones flanked by gaps.
      const leftVal = D[left];
      if (cell !== NEG && (cell >= leftVal || leftVal === NEG)) {
        D[here] = cell;
        prevD[here] = j;
      } else {
        D[here] = leftVal;
        prevD[here] = prevD[left];
      }
    }
  }

  // Locate the best end cell for the full query.
  let bestScore = NEG;
  let bestJ = -1;
  const lastRow = m * stride;
  for (let j = 1; j <= n; j++) {
    const v = C[lastRow + j];
    if (v !== NEG && v > bestScore) {
      bestScore = v;
      bestJ = j;
    }
  }

  if (bestJ < 0) {
    return { matched: false, score: 0, positions: [] };
  }

  const positions: number[] = [];
  let i = m;
  let j = bestJ;
  while (i > 0 && j > 0) {
    positions.push(j - 1);
    const p = prevC[i * stride + j];
    // Self-reference means this is the first matched character; stop.
    if (p === j || p < 0) {
      break;
    }
    j = p;
    i -= 1;
  }
  positions.reverse();

  return { matched: true, score: bestScore, positions };
}

export interface FuzzyScored<T> {
  item: T;
  score: number;
  positions: number[];
}

/**
 * Filter `items` to those whose `getText(item)` contains `query` as a fuzzy
 * subsequence, sorted by descending score. An empty `query` returns every
 * item with a neutral score (preserving input order via a stable sort).
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  options: FuzzyOptions = {}
): FuzzyScored<T>[] {
  if (!query) {
    return items.map((item) => ({ item, score: 0, positions: [] }));
  }

  const scored: FuzzyScored<T>[] = [];
  for (const item of items) {
    const result = fuzzyMatch(query, getText(item), options);
    if (result.matched) {
      scored.push({ item, score: result.score, positions: result.positions });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
