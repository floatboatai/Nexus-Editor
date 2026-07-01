/**
 * Fuzzy subsequence matcher for editor search.
 *
 * Characters in the query must appear in order within the target text, but
 * not necessarily adjacent. A backtracking DFS explores every valid placement
 * when multiple haystack positions match the next pattern character, then
 * keeps the highest-scoring path (consecutive runs and word-start hits score
 * higher; shorter spans win ties).
 */

/** Score bonus for each consecutive character in the matched subsequence. */
const CONSECUTIVE_BONUS = 8;

/** Score bonus when a matched character sits at a word boundary. */
const WORD_START_BONUS = 6;

/** Penalty applied per extra character inside the matched span. */
const SPAN_LENGTH_PENALTY = 2;

/** Reject overly long queries before DFS to avoid exponential blow-ups. */
export const MAX_FUZZY_PATTERN_LENGTH = 100;

/** Skip fuzzy scanning inside very long tokens (URLs, base64 blobs, etc.). */
export const MAX_FUZZY_TOKEN_LENGTH = 4096;

export interface FuzzySpan {
  /** Inclusive start offset within the searched text. */
  from: number;
  /** Exclusive end offset within the searched text. */
  to: number;
  score: number;
}

export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = text[index - 1];
  return /\W/.test(prev);
}

function scoreMatchedIndices(text: string, indices: readonly number[]): number {
  let score = indices.length * 10;
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    if (i > 0 && indices[i - 1] === index - 1) {
      score += CONSECUTIVE_BONUS;
    }
    if (isWordStart(text, index)) {
      score += WORD_START_BONUS;
    }
  }

  const spanLength = indices[indices.length - 1] - indices[0] + 1;
  score -= Math.max(0, spanLength - indices.length) * SPAN_LENGTH_PENALTY;
  return score;
}

/**
 * Find the single best fuzzy subsequence of `pattern` inside `text`.
 * Returns `null` when no placement satisfies the subsequence constraint.
 */
export function findBestFuzzyMatch(
  text: string,
  pattern: string,
  options: FuzzyMatchOptions = {}
): FuzzySpan | null {
  if (!pattern || pattern.length > MAX_FUZZY_PATTERN_LENGTH) {
    return null;
  }

  const caseSensitive = options.caseSensitive ?? false;
  const normalizedPattern = caseSensitive ? pattern : pattern.toLowerCase();
  const normalizedText = caseSensitive ? text : text.toLowerCase();

  let best: { indices: number[]; score: number } | null = null;

  // Backtracking: for each pattern character, try every valid haystack index
  // from the current cursor forward and recurse. The DFS depth equals the
  // pattern length, which is bounded by practical search queries (< 100).
  function visit(patternIndex: number, textIndex: number, indices: number[]): void {
    if (patternIndex === normalizedPattern.length) {
      const score = scoreMatchedIndices(text, indices);
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          indices[indices.length - 1] - indices[0] < best.indices[best.indices.length - 1] - best.indices[0])
      ) {
        best = { indices: indices.slice(), score };
      }
      return;
    }

    const target = normalizedPattern[patternIndex];
    for (let i = textIndex; i < normalizedText.length; i++) {
      if (normalizedText[i] !== target) {
        continue;
      }
      indices.push(i);
      visit(patternIndex + 1, i + 1, indices);
      indices.pop();
    }
  }

  visit(0, 0, []);

  if (!best) {
    return null;
  }

  const from = best.indices[0];
  const to = best.indices[best.indices.length - 1] + 1;
  return { from, to, score: best.score };
}

/**
 * Collect every non-overlapping fuzzy match inside `text`, scanning left to
 * right and restarting one code unit after each accepted span.
 */
export function findAllFuzzyMatchesInText(
  text: string,
  pattern: string,
  options: FuzzyMatchOptions = {}
): FuzzySpan[] {
  if (!pattern || pattern.length > MAX_FUZZY_PATTERN_LENGTH) {
    return [];
  }

  const matches: FuzzySpan[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const slice = text.slice(cursor);
    const match = findBestFuzzyMatch(slice, pattern, options);
    if (!match) {
      break;
    }

    matches.push({
      from: cursor + match.from,
      to: cursor + match.to,
      score: match.score
    });
    cursor += match.from + 1;
  }

  return matches;
}

const TOKEN_PATTERN = /\S+/g;

/**
 * Scan a document token-by-token (continuous non-whitespace runs) so fuzzy
 * search does not bridge unrelated words across whitespace.
 */
export function findFuzzyMatchesInDocument(
  doc: string,
  pattern: string,
  options: FuzzyMatchOptions = {}
): Array<{ from: number; to: number; text: string }> {
  if (!pattern || pattern.length > MAX_FUZZY_PATTERN_LENGTH) {
    return [];
  }

  const matches: Array<{ from: number; to: number; text: string }> = [];
  TOKEN_PATTERN.lastIndex = 0;

  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = TOKEN_PATTERN.exec(doc)) !== null) {
    const token = tokenMatch[0];
    if (token.length > MAX_FUZZY_TOKEN_LENGTH) {
      continue;
    }
    const tokenStart = tokenMatch.index;
    const tokenMatches = findAllFuzzyMatchesInText(token, pattern, options);

    for (const span of tokenMatches) {
      const from = tokenStart + span.from;
      const to = tokenStart + span.to;
      matches.push({
        from,
        to,
        text: doc.slice(from, to)
      });
    }
  }

  return matches;
}

/**
 * Replace every fuzzy match in `doc`, applying edits from the end so offsets
 * stay valid (shared by the public API and the CM fuzzy-replace commands).
 */
export function replaceFuzzyMatchesInDocument(
  doc: string,
  pattern: string,
  replacement: string,
  options: FuzzyMatchOptions = {}
): string {
  const matches = findFuzzyMatchesInDocument(doc, pattern, options);
  let result = doc;
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    result = result.slice(0, match.from) + replacement + result.slice(match.to);
  }
  return result;
}
