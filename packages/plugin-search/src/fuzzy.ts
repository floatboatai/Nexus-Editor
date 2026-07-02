/**
 * fzf-style fuzzy matching.
 *
 * A query matches a text when its characters appear in the text in order but
 * not necessarily contiguously (a subsequence match). Each match is scored so
 * that the most "intuitive" alignment ranks highest: contiguous runs, matches
 * at word boundaries, and matches near the start of the text are all rewarded,
 * while gaps between matched characters are penalized.
 *
 * The algorithm mirrors fzf's `FuzzyMatchV1`: a forward + backward scan narrows
 * the text to the shortest window that still contains the query as a
 * subsequence, then a single linear pass over that window computes the score
 * and the matched positions. This keeps matching at O(n) per candidate, which
 * matters because {@link findFuzzyMatches} runs the matcher once per line.
 */

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;

/** Reward for matching the first character of a word (start / after separator). */
const BONUS_BOUNDARY = SCORE_MATCH / 2;
/** Reward for a camelCase or letter→number boundary (`fooBar`, `v2`). */
const BONUS_CAMEL_123 = BONUS_BOUNDARY + SCORE_GAP_EXTENSION;
/** Reward for a match that immediately follows the previous match. */
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);
/** Boundary bonuses count double on the query's first character. */
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

const enum CharClass {
  Whitespace,
  NonWord,
  Lower,
  Upper,
  Letter,
  Number
}

const LETTER = /\p{L}/u;
const NUMBER = /[0-9]/;
const WHITESPACE = /\s/;

function charClassOf(ch: string): CharClass {
  if (WHITESPACE.test(ch)) return CharClass.Whitespace;
  if (NUMBER.test(ch)) return CharClass.Number;
  if (LETTER.test(ch)) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper) return CharClass.Letter; // caseless script (e.g. CJK)
    return ch === lower ? CharClass.Lower : CharClass.Upper;
  }
  return CharClass.NonWord;
}

function bonusFor(prev: CharClass, curr: CharClass): number {
  if (curr === CharClass.Whitespace || curr === CharClass.NonWord) {
    return 0;
  }
  // `curr` is a word character (letter or number).
  if (prev === CharClass.Whitespace || prev === CharClass.NonWord) {
    return BONUS_BOUNDARY;
  }
  if (prev === CharClass.Lower && curr === CharClass.Upper) {
    return BONUS_CAMEL_123;
  }
  if (prev !== CharClass.Number && curr === CharClass.Number) {
    return BONUS_CAMEL_123;
  }
  return 0;
}

export interface FuzzyMatchOptions {
  /** Match upper/lower case exactly. Defaults to false (case-insensitive). */
  caseSensitive?: boolean;
}

export interface FuzzyMatchResult {
  /** Higher is a better match. Only meaningful relative to other results. */
  score: number;
  /** Indices into the matched text, one per query character, ascending. */
  positions: number[];
}

function foldCase(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

/**
 * Score how well `query` fuzzy-matches `text`. Returns `null` when `query` is
 * not a subsequence of `text`. An empty query matches everything with score 0.
 */
export function fuzzyMatch(
  text: string,
  query: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult | null {
  if (query.length === 0) {
    return { score: 0, positions: [] };
  }
  if (text.length === 0) {
    return null;
  }

  const caseSensitive = options.caseSensitive ?? false;
  const foldedText = foldCase(text, caseSensitive);
  const foldedQuery = foldCase(query, caseSensitive);

  // Forward scan: earliest position where the whole query has been consumed.
  let queryIdx = 0;
  let start = -1;
  let end = -1;
  for (let idx = 0; idx < foldedText.length; idx++) {
    if (foldedText[idx] === foldedQuery[queryIdx]) {
      if (start < 0) start = idx;
      queryIdx++;
      if (queryIdx === foldedQuery.length) {
        end = idx + 1;
        break;
      }
    }
  }
  if (end < 0) {
    return null;
  }

  // Backward scan: pull `start` forward to the shortest window that still
  // contains the query, so leading gaps are not scored against the match.
  queryIdx = foldedQuery.length - 1;
  for (let idx = end - 1; idx >= start; idx--) {
    if (foldedText[idx] === foldedQuery[queryIdx]) {
      if (--queryIdx < 0) {
        start = idx;
        break;
      }
    }
  }

  return scoreWindow(text, foldedText, foldedQuery, start, end);
}

function scoreWindow(
  text: string,
  foldedText: string,
  foldedQuery: string,
  start: number,
  end: number
): FuzzyMatchResult {
  const positions: number[] = [];
  let score = 0;
  let queryIdx = 0;
  let inGap = false;
  let consecutive = 0;
  let firstBonus = 0;
  let prevClass = start > 0 ? charClassOf(text[start - 1]) : CharClass.Whitespace;

  for (let idx = start; idx < end; idx++) {
    const currClass = charClassOf(text[idx]);

    if (queryIdx < foldedQuery.length && foldedText[idx] === foldedQuery[queryIdx]) {
      positions.push(idx);
      score += SCORE_MATCH;

      let bonus = bonusFor(prevClass, currClass);
      if (consecutive === 0) {
        firstBonus = bonus;
      } else {
        // Inside a consecutive run, keep the strongest boundary bonus seen so
        // the run is anchored to where the word actually started.
        if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }

      score += queryIdx === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;

      inGap = false;
      consecutive++;
      queryIdx++;
    } else {
      score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }

    prevClass = currClass;
  }

  return { score, positions };
}

export interface FuzzyMatch extends FuzzyMatchResult {
  /** Absolute offset of the first matched character in the document. */
  from: number;
  /** Absolute offset just past the last matched character. */
  to: number;
  /** The full text of the matched line. */
  text: string;
  /** Zero-based line index of the match. */
  line: number;
}

/**
 * Fuzzy-search a document line by line. Every line that contains `query` as a
 * subsequence produces one {@link FuzzyMatch}, and the results are ranked best
 * match first. `from`/`to`/`positions` are absolute document offsets, ready to
 * feed a highlight decoration or a "jump to match" affordance.
 *
 * Returns an empty array for an empty query, matching {@link findSearchMatches}.
 */
export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatch[] {
  if (query.length === 0) {
    return [];
  }

  const matches: FuzzyMatch[] = [];
  const lines = doc.split("\n");
  let lineStart = 0;

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const result = fuzzyMatch(text, query, options);

    if (result && result.positions.length > 0) {
      const positions = result.positions.map((pos) => pos + lineStart);
      matches.push({
        from: positions[0],
        to: positions[positions.length - 1] + 1,
        text,
        line,
        score: result.score,
        positions
      });
    }

    lineStart += text.length + 1; // account for the "\n" removed by split
  }

  matches.sort((a, b) => b.score - a.score || a.from - b.from);
  return matches;
}

export interface FuzzyFilterOptions<T> extends FuzzyMatchOptions {
  /**
   * Extract the string to match from each item. Defaults to identity, so the
   * items must be strings unless a `key` is supplied.
   */
  key?: (item: T) => string;
  /** Keep at most this many results (applied after ranking). */
  limit?: number;
}

export interface FuzzyFilterResult<T> extends FuzzyMatchResult {
  /** The original item. */
  item: T;
  /** The string that was matched — the result of `key(item)`. */
  text: string;
}

/**
 * Rank a list of candidates against a query — the building block for a
 * quick-open dialog, command palette, or symbol picker. Items that do not
 * fuzzy-match are dropped; the rest are sorted best match first, ties broken by
 * original order.
 *
 * Unlike {@link findFuzzyMatches}, an empty query returns *every* item (in
 * input order, score 0): a picker shows the full list before you type.
 * `positions` are indices into each item's own `text`.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  options: FuzzyFilterOptions<T> = {}
): FuzzyFilterResult<T>[] {
  const key = options.key ?? ((item: T) => item as unknown as string);
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
  const clamp = <U>(list: U[]): U[] => (limit === undefined ? list : list.slice(0, limit));

  if (query.length === 0) {
    return clamp(items.map((item) => ({ item, text: key(item), score: 0, positions: [] })));
  }

  const ranked: Array<FuzzyFilterResult<T> & { index: number }> = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const text = key(item);
    const match = fuzzyMatch(text, query, options);
    if (match) {
      ranked.push({ item, text, score: match.score, positions: match.positions, index });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return clamp(ranked).map(({ index: _index, ...result }) => result);
}
