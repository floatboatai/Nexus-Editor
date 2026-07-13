// Fuzzy search implementation for plugin-search.
//
// Strategy: per-line dynamic programming on (j, i) where needle[j]
// matches text[i]. The score at (j, i) is the maximum over p < i of
// (score at (j-1, p) + transition cost from p to i). The terminal
// cell with the highest score in the last needle row wins.
//
// Scoring model:
//   - BASE_BONUS per matched character
//   - CONSECUTIVE_BONUS when consecutive
//   - WORD_START_BONUS for matches following a non-word char
//   - CAMEL_CASE_BONUS for lowercase->uppercase transitions
//   - SHORT_JUMP_BONUS / LONG_JUMP_PENALTY by jump distance
//   - MISMATCH_PENALTY for any non-consecutive match
//
// Complexity: O(nLen * L^2) per line, where L is the line length.
// The function is single-line, so callers split the document first.

export interface FuzzyMatch {
  /** Start index (inclusive) of the match in the text. */
  from: number;
  /** End index (exclusive) of the match in the text. */
  to: number;
  /** Matched substring. */
  text: string;
  /** Score used for ranking. Higher is better. */
  score: number;
  /** Per-character match positions within [from, to). */
  positions: number[];
}

export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
  /**
   * Drop matches whose score is below this fraction of the
   * theoretical best score for the given query. Defaults to 0
   * (keep everything that matched).
   */
  minScoreRatio?: number;
}

const BASE_BONUS = 10;
const CONSECUTIVE_BONUS = 5;
const WORD_START_BONUS = 8;
const CAMEL_CASE_BONUS = 4;
const SHORT_JUMP_BONUS = 3;
const LONG_JUMP_PENALTY = -2;
const MISMATCH_PENALTY = -1;

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isUpperCase(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isLowerCase(ch: string): boolean {
  return ch >= "a" && ch <= "z";
}

interface MatchCell {
  score: number;
  prev: number | null;
}

const NEG_INF_CELL: MatchCell = { score: Number.NEGATIVE_INFINITY, prev: null };

function bestMatchInLine(
  line: string,
  query: string,
  caseSensitive: boolean
): { from: number; to: number; text: string; score: number; positions: number[] } | null {
  if (!query) return null;

  const haystack = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return null;
  const nLen = needle.length;
  if (nLen === 0) return null;
  if (haystack.length < nLen) return null;

  // dp[j][i] = best score for matching needle[0..j] ending at haystack[i],
  // plus the previous matched haystack position (for path recovery).
  const L = haystack.length;
  const dp: MatchCell[][] = [];
  for (let j = 0; j < nLen; j++) {
    dp.push(new Array<MatchCell>(L).fill(NEG_INF_CELL));
  }

  // Initialize j=0 row: each haystack position i where needle[0] matches
  // is a candidate start. Word-start bonus applies at line start and
  // after any non-word character.
  let anyMatch = false;
  for (let i = 0; i < L; i++) {
    if (haystack[i] !== needle[0]) continue;
    anyMatch = true;
    const prevOrig = i > 0 ? (caseSensitive ? haystack[i - 1] : line[i - 1]) : "";
    const wordStart = i === 0 || !isWordChar(prevOrig) ? WORD_START_BONUS : 0;
    dp[0][i] = { score: BASE_BONUS + wordStart, prev: null };
  }
  if (!anyMatch) return null;

  // Fill remaining rows.
  for (let j = 1; j < nLen; j++) {
    const target = needle[j];
    for (let i = j; i < L; i++) {
      if (haystack[i] !== target) continue;
      let bestCell: MatchCell = NEG_INF_CELL;
      for (let p = 0; p < i; p++) {
        const prev = dp[j - 1][p];
        if (prev.score === Number.NEGATIVE_INFINITY) continue;
        let s = prev.score;
        const jump = i - p;
        if (jump === 1) {
          s += CONSECUTIVE_BONUS;
        } else {
          s += MISMATCH_PENALTY;
          if (jump <= 3) {
            s += SHORT_JUMP_BONUS;
          } else {
            s += LONG_JUMP_PENALTY;
          }
          const prevChar = caseSensitive ? haystack[i - 1] : line[i - 1];
          if (!isWordChar(prevChar)) {
            s += WORD_START_BONUS;
          }
          const prevOrig = caseSensitive ? haystack[i - 1] : line[i - 1];
          const currOrig = caseSensitive ? haystack[i] : line[i];
          if (isLowerCase(prevOrig) && isUpperCase(currOrig)) {
            s += CAMEL_CASE_BONUS;
          }
        }
        s += BASE_BONUS;
        if (s > bestCell.score) {
          bestCell = { score: s, prev: p };
        }
      }
      if (bestCell.score !== Number.NEGATIVE_INFINITY) {
        dp[j][i] = bestCell;
      }
    }
  }

  // Find best terminal cell in the last row.
  const lastRow = dp[nLen - 1];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestEnd = -1;
  for (let i = nLen - 1; i < L; i++) {
    if (lastRow[i].score > bestScore) {
      bestScore = lastRow[i].score;
      bestEnd = i;
    }
  }
  if (bestEnd === -1) return null;

  // Backtrack positions.
  const positions: number[] = new Array(nLen);
  let curEnd = bestEnd;
  for (let j = nLen - 1; j >= 0; j--) {
    positions[j] = curEnd;
    const cell = dp[j][curEnd];
    if (j > 0 && cell.prev !== null) {
      curEnd = cell.prev;
    }
  }

  const from = positions[0];
  const to = positions[positions.length - 1] + 1;
  return {
    from,
    to,
    text: line.slice(from, to),
    score: bestScore,
    positions
  };
}

function theoreticalMaxScore(query: string): number {
  const len = query.length;
  if (len === 0) return 0;
  let score = len * BASE_BONUS;
  score += WORD_START_BONUS;
  for (let i = 1; i < len; i++) {
    score += CONSECUTIVE_BONUS;
  }
  return score;
}

/**
 * Run a fuzzy search over a document and return all matches in
 * document order. Each match is anchored to a single line.
 */
export function fuzzyFindAll(
  doc: string,
  query: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatch[] {
  if (!query) return [];
  const caseSensitive = options.caseSensitive === true;
  const minRatio = options.minScoreRatio ?? 0;
  const maxScore = theoreticalMaxScore(query);
  const threshold = maxScore * minRatio;

  const results: FuzzyMatch[] = [];
  const lines: { text: string; offset: number }[] = [];
  let cursor = 0;
  for (const part of doc.split(/(\n)/)) {
    if (part === "\n") {
      cursor += 1;
      continue;
    }
    lines.push({ text: part, offset: cursor });
    cursor += part.length;
  }
  if (lines.length === 0) return [];

  for (const line of lines) {
    const m = bestMatchInLine(line.text, query, caseSensitive);
    if (m === null) continue;
    if (m.score < threshold) continue;
    results.push({
      from: m.from + line.offset,
      to: m.to + line.offset,
      text: m.text,
      score: m.score,
      positions: m.positions.map((p) => p + line.offset)
    });
  }
  return results;
}

/**
 * Replace every fuzzy match with `replacement`. Replacements are
 * applied left-to-right; positions are recomputed after each
 * replacement to reflect the current document state.
 */
export function fuzzyReplaceAll(
  doc: string,
  query: string,
  replacement: string,
  options: FuzzyMatchOptions = {}
): string {
  const matches = fuzzyFindAll(doc, query, options);
  if (matches.length === 0) return doc;
  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += doc.slice(cursor, match.from);
    out += replacement;
    cursor = match.to;
  }
  out += doc.slice(cursor);
  return out;
}
