/**
 * Dependency-free fuzzy (subsequence) matching for candidate-list search —
 * the slash menu today, host-owned command palettes and quick switchers next.
 *
 * The matcher aligns every query character to a distinct target character in
 * order and scores the alignment, so "start of a word", "camelCase hump" and
 * "adjacent characters" rank above scattered mid-word hits. Positions are
 * UTF-16 code-unit offsets into the *original* target, which lets callers use
 * them directly with `String.prototype.slice` when rendering highlights.
 *
 * Complexity is `O(query × target)` time and memory for targets up to
 * {@link MAX_OPTIMAL_ALIGNMENT_TARGET}; longer targets are aligned greedily so
 * a pathological input cannot blow up a keystroke. Both paths score with the
 * same weights, only the optimality guarantee differs.
 */

export interface FuzzyMatchOptions {
  /**
   * Compare characters case-sensitively. Defaults to `false`; matching without
   * case sensitivity still rewards an exact-case hit, so the query `H` prefers
   * `Heading` over `heading`.
   */
  caseSensitive?: boolean;
}

export interface FuzzyMatchResult {
  /**
   * Alignment score — higher is better. Scores are relative within one matcher
   * configuration and may be negative when an alignment skips more characters
   * than it matches.
   */
  score: number;
  /**
   * Ascending UTF-16 code-unit offsets in the original target. The length
   * always equals the query length.
   */
  positions: number[];
}

/** Score for every matched character — has to pay for the characters it skips. */
const MATCH_BASE = 16;
/** A hit at the very start of the target: what a prefix query means. */
const BONUS_TARGET_START = 10;
/** A hit at a word start: after a separator, or starting a CJK run. */
const BONUS_WORD_START = 8;
/** A hit at a camelCase hump (`g`→`C` in `getContent`). */
const BONUS_CAMEL_CASE = 7;
/** A hit directly after the previous matched character. */
const BONUS_ADJACENT = 8;
/** Exact-case hit while matching case-insensitively — a tiebreaker, not a signal. */
const BONUS_EXACT_CASE = 1;
/** Opening a gap is worse than extending one. */
const GAP_START_PENALTY = 3;
/** Each additional skipped character. */
const GAP_EXTENSION_PENALTY = 1;

/**
 * Targets up to this length get the optimal (backtracking) alignment. Beyond
 * it the greedy alignment keeps both time and memory linear; candidates in
 * this codebase are titles, keywords and file names, so the cut-off is only a
 * guard against a host passing a whole document.
 */
const MAX_OPTIMAL_ALIGNMENT_TARGET = 512;

const ORIGIN_FIRST = -1;
const ORIGIN_UNREACHABLE = -2;

const SEPARATORS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "-",
  "_",
  "/",
  "\\",
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  "'",
  '"',
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  "|",
  "+",
  "=",
  "*",
  "&",
  "^",
  "%",
  "$",
  "#",
  "@",
  "~",
  "`"
]);

const IDEOGRAPH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ASCII_LOWER_OR_DIGIT = /[a-z0-9]/;
const ASCII_UPPER = /[A-Z]/;

interface StringView {
  /** The string split into code points. */
  chars: string[];
  /** Code-unit offset of each entry in `chars`. */
  offsets: number[];
  /** Comparison form of each entry — lower-cased unless case-sensitive. */
  folded: string[];
}

interface Alignment {
  score: number;
  /** Code-point indices into the target view. */
  indices: number[];
}

function buildView(value: string, caseSensitive: boolean): StringView {
  const chars: string[] = [];
  const offsets: number[] = [];
  const folded: string[] = [];
  let offset = 0;

  for (const char of value) {
    chars.push(char);
    offsets.push(offset);
    folded.push(caseSensitive ? char : char.toLowerCase());
    offset += char.length;
  }

  return { chars, offsets, folded };
}

function isIdeograph(char: string): boolean {
  return IDEOGRAPH.test(char);
}

/**
 * Positional bonus for matching `chars[index]`. Deliberately independent of the
 * previous match so the alignment recurrence stays a simple maximum.
 */
function positionBonus(chars: string[], index: number): number {
  if (index === 0) return BONUS_TARGET_START;

  const previous = chars[index - 1];
  const current = chars[index];

  if (SEPARATORS.has(previous)) return BONUS_WORD_START;
  if (ASCII_LOWER_OR_DIGIT.test(previous) && ASCII_UPPER.test(current)) return BONUS_CAMEL_CASE;
  // Ideographs carry a word each, so a run of them starts a word. Without this
  // a CJK query would only ever score as a mid-word hit.
  if (isIdeograph(current) && !isIdeograph(previous)) return BONUS_WORD_START;

  return 0;
}

function exactCaseBonus(queryChar: string, targetChar: string): number {
  return queryChar === targetChar ? BONUS_EXACT_CASE : 0;
}

/** First-match-wins walk: cheap feasibility check, and the long-target path. */
function findGreedyAlignment(query: StringView, target: StringView): number[] | null {
  const indices: number[] = [];
  let cursor = 0;

  for (const queryChar of query.folded) {
    while (cursor < target.folded.length && target.folded[cursor] !== queryChar) {
      cursor++;
    }
    if (cursor === target.folded.length) return null;

    indices.push(cursor);
    cursor++;
  }

  return indices;
}

function scoreAlignment(indices: number[], query: StringView, target: StringView): number {
  let score = 0;
  let previous = -1;

  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    const skipped = index - previous - 1;

    score +=
      MATCH_BASE +
      positionBonus(target.chars, index) +
      exactCaseBonus(query.chars[i], target.chars[index]);

    // `previous` starts at -1, so the first match must not award adjacency.
    if (i > 0 && previous === index - 1) score += BONUS_ADJACENT;
    if (skipped > 0) score -= GAP_START_PENALTY + (skipped - 1) * GAP_EXTENSION_PENALTY;

    previous = index;
  }

  return score;
}

/**
 * Highest-scoring alignment via dynamic programming over
 * `(query character, target character)` pairs. The gap branch folds
 * `GAP_EXTENSION_PENALTY` into a running maximum so every cell is `O(1)`.
 */
function alignOptimal(query: StringView, target: StringView): Alignment | null {
  const queryLength = query.folded.length;
  const targetLength = target.folded.length;
  const scores = new Float64Array(queryLength * targetLength).fill(Number.NEGATIVE_INFINITY);
  const origins = new Int32Array(queryLength * targetLength).fill(ORIGIN_UNREACHABLE);

  for (let i = 0; i < queryLength; i++) {
    const rowStart = i * targetLength;
    const previousRowStart = rowStart - targetLength;
    let bestGapScore = Number.NEGATIVE_INFINITY;
    let bestGapOrigin = ORIGIN_UNREACHABLE;

    for (let j = 0; j < targetLength; j++) {
      if (i > 0 && j >= 2) {
        const candidate = scores[previousRowStart + (j - 2)];
        if (candidate > Number.NEGATIVE_INFINITY) {
          const adjusted = candidate + (j - 2) * GAP_EXTENSION_PENALTY;
          // Strict improvement keeps the latest (tightest) origin on ties.
          if (adjusted > bestGapScore) {
            bestGapScore = adjusted;
            bestGapOrigin = j - 2;
          }
        }
      }

      if (target.folded[j] !== query.folded[i]) continue;

      const matchScore =
        MATCH_BASE +
        positionBonus(target.chars, j) +
        exactCaseBonus(query.chars[i], target.chars[j]);

      if (i === 0) {
        const leadingGap = j === 0 ? 0 : GAP_START_PENALTY + (j - 1) * GAP_EXTENSION_PENALTY;
        scores[rowStart + j] = matchScore - leadingGap;
        origins[rowStart + j] = ORIGIN_FIRST;
        continue;
      }

      let best = Number.NEGATIVE_INFINITY;
      let origin = ORIGIN_UNREACHABLE;

      if (j >= 1) {
        const adjacent = scores[previousRowStart + (j - 1)];
        if (adjacent > Number.NEGATIVE_INFINITY) {
          best = adjacent + matchScore + BONUS_ADJACENT;
          origin = j - 1;
        }
      }

      if (bestGapScore > Number.NEGATIVE_INFINITY) {
        const gapped =
          bestGapScore + matchScore - GAP_START_PENALTY - (j - 2) * GAP_EXTENSION_PENALTY;
        if (gapped > best) {
          best = gapped;
          origin = bestGapOrigin;
        }
      }

      if (origin === ORIGIN_UNREACHABLE) continue;
      scores[rowStart + j] = best;
      origins[rowStart + j] = origin;
    }
  }

  const lastRowStart = (queryLength - 1) * targetLength;
  let bestEnd = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let j = queryLength - 1; j < targetLength; j++) {
    const value = scores[lastRowStart + j];
    // Strict comparison prefers the earliest end on ties, i.e. the tightest
    // alignment, which keeps results deterministic.
    if (value > bestScore) {
      bestScore = value;
      bestEnd = j;
    }
  }

  if (bestEnd < 0) return null;

  const indices = new Array<number>(queryLength);
  let cursor = bestEnd;

  for (let i = queryLength - 1; i >= 0; i--) {
    indices[i] = cursor;
    const origin = origins[i * targetLength + cursor];
    if (origin === ORIGIN_FIRST) break;
    cursor = origin;
  }

  return { score: bestScore, indices };
}

/**
 * Fuzzy-match `query` against `target`.
 *
 * @returns `null` when the query is empty, the target is empty, or the query
 *   characters are not all present in the target in order.
 */
export function matchFuzzy(
  query: string,
  target: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult | null {
  const caseSensitive = options.caseSensitive ?? false;
  const queryView = buildView(query, caseSensitive);
  const targetView = buildView(target, caseSensitive);

  if (queryView.folded.length === 0) return null;
  if (targetView.folded.length < queryView.folded.length) return null;

  const greedy = findGreedyAlignment(queryView, targetView);
  if (greedy === null) return null;

  // The greedy alignment is always reachable, so the fallback only guards
  // against a future change to the recurrence.
  const alignment =
    targetView.folded.length > MAX_OPTIMAL_ALIGNMENT_TARGET
      ? { score: scoreAlignment(greedy, queryView, targetView), indices: greedy }
      : alignOptimal(queryView, targetView) ?? {
          score: scoreAlignment(greedy, queryView, targetView),
          indices: greedy
        };

  return {
    score: alignment.score,
    positions: alignment.indices.map((index) => targetView.offsets[index])
  };
}
