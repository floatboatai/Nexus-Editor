export interface FuzzyMatch {
  from: number;
  to: number;
  text: string;
  score: number;
}

export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
}

const SCORE_MATCH = 16;
const SCORE_CONSECUTIVE = 32;
const SCORE_WORD_START = 24;
const SCORE_GAP_PENALTY = 4;

interface DpCell {
  score: number;
  consecutive: number;
}

function normalizeForCompare(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return !/[\p{L}\p{N}_]/u.test(prev);
}

function scoreMatchStep(
  doc: string,
  index: number,
  prevMatch: number,
  consecutive: number
): { scoreDelta: number; consecutive: number } {
  let scoreDelta = SCORE_MATCH;
  let newConsecutive = 0;

  if (prevMatch === index - 1) {
    newConsecutive = consecutive + 1;
    scoreDelta += SCORE_CONSECUTIVE * newConsecutive;
  } else if (prevMatch >= 0) {
    scoreDelta -= (index - prevMatch - 1) * SCORE_GAP_PENALTY;
  }

  if (isWordBoundary(doc, index)) {
    scoreDelta += SCORE_WORD_START;
  }

  return { scoreDelta, consecutive: newConsecutive };
}

/**
 * Score a matched span. Higher is better. Rewards consecutive query
 * characters, word-boundary hits, and shorter spans.
 */
export function scoreFuzzySpan(
  doc: string,
  from: number,
  to: number,
  query: string,
  caseSensitive: boolean
): number {
  const haystack = normalizeForCompare(doc, caseSensitive);
  const needle = normalizeForCompare(query, caseSensitive);

  let score = 0;
  let queryIndex = 0;
  let previousMatch = -2;
  let consecutive = 0;

  for (let i = from; i < to && queryIndex < needle.length; i++) {
    if (haystack[i] !== needle[queryIndex]) continue;

    const step = scoreMatchStep(doc, i, previousMatch, consecutive);
    score += step.scoreDelta;
    consecutive = step.consecutive;
    previousMatch = i;
    queryIndex += 1;
  }

  score -= Math.max(0, to - from - needle.length);
  return score;
}

function spansOverlap(a: FuzzyMatch, b: FuzzyMatch): boolean {
  return a.from < b.to && b.from < a.to;
}

function compareFuzzyMatchQuality(a: FuzzyMatch, b: FuzzyMatch): number {
  if (b.score !== a.score) return b.score - a.score;

  const lengthDelta = a.to - a.from - (b.to - b.from);
  if (lengthDelta !== 0) return lengthDelta;

  if (a.from !== b.from) return a.from - b.from;
  return a.to - b.to;
}

/**
 * Drop overlapping spans, keeping the highest-quality match in each
 * cluster, then return survivors in document order for navigation.
 */
export function rankFuzzyMatches(matches: FuzzyMatch[]): FuzzyMatch[] {
  if (matches.length <= 1) {
    return matches.slice();
  }

  const sortedByQuality = [...matches].sort(compareFuzzyMatchQuality);
  const kept: FuzzyMatch[] = [];

  for (const match of sortedByQuality) {
    if (kept.some((existing) => spansOverlap(existing, match))) continue;
    kept.push(match);
  }

  kept.sort((a, b) => a.from - b.from || a.to - b.to);
  return kept;
}

/**
 * Backtracking DP: for a fixed start offset, explore every subsequence
 * path and return the span with the highest score.
 */
export function findBestFuzzySpanFromStart(
  doc: string,
  query: string,
  start: number,
  options: FuzzyMatchOptions = {}
): FuzzyMatch | null {
  const trimmed = query.trim();
  if (!trimmed || start < 0 || start >= doc.length) return null;

  const caseSensitive = options.caseSensitive ?? false;
  const haystack = normalizeForCompare(doc, caseSensitive);
  const needle = normalizeForCompare(trimmed, caseSensitive);

  if (haystack[start] !== needle[0]) return null;

  const firstStep = scoreMatchStep(doc, start, -1, 0);
  let prevLayer = new Map<number, DpCell>([
    [start, { score: firstStep.scoreDelta, consecutive: firstStep.consecutive }]
  ]);

  for (let j = 1; j < needle.length; j++) {
    const nextLayer = new Map<number, DpCell>();

    for (const [prevPos, cell] of prevLayer) {
      for (let i = prevPos + 1; i < doc.length; i++) {
        if (haystack[i] !== needle[j]) continue;

        const step = scoreMatchStep(doc, i, prevPos, cell.consecutive);
        const newScore = cell.score + step.scoreDelta;
        const existing = nextLayer.get(i);

        if (!existing || newScore > existing.score) {
          nextLayer.set(i, {
            score: newScore,
            consecutive: step.consecutive
          });
        }
      }
    }

    if (nextLayer.size === 0) return null;
    prevLayer = nextLayer;
  }

  let bestEnd = -1;
  let bestScore = -Infinity;

  for (const [endPos, cell] of prevLayer) {
    const spanLen = endPos + 1 - start;
    const finalScore = cell.score - Math.max(0, spanLen - needle.length);
    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestEnd = endPos + 1;
    }
  }

  if (bestEnd < 0) return null;

  return {
    from: start,
    to: bestEnd,
    text: doc.slice(start, bestEnd),
    score: bestScore
  };
}

/**
 * Find subsequence matches using per-anchor DP backtracking, then dedupe
 * overlapping spans and keep the highest-quality survivor in each cluster.
 */
export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const caseSensitive = options.caseSensitive ?? false;
  const haystack = normalizeForCompare(doc, caseSensitive);
  const needle = normalizeForCompare(trimmed, caseSensitive);
  const matches: FuzzyMatch[] = [];

  for (let start = 0; start < doc.length; start++) {
    if (haystack[start] !== needle[0]) continue;

    const match = findBestFuzzySpanFromStart(doc, trimmed, start, options);
    if (match) matches.push(match);
  }

  return rankFuzzyMatches(matches);
}

export function selectionOverlapsFuzzyMatch(
  selectionFrom: number,
  selectionTo: number,
  match: FuzzyMatch
): boolean {
  const from = Math.min(selectionFrom, selectionTo);
  const to = Math.max(selectionFrom, selectionTo);
  return match.from < to && from < match.to;
}

/**
 * Pick the next fuzzy match for navigation. When the current selection does
 * not overlap any match, jump to the globally highest-scoring span first.
 */
export function pickNextFuzzyMatch(
  matches: FuzzyMatch[],
  selectionFrom: number,
  selectionTo: number
): FuzzyMatch | null {
  if (matches.length === 0) return null;

  const activeIndex = matches.findIndex((match) =>
    selectionOverlapsFuzzyMatch(selectionFrom, selectionTo, match)
  );

  if (activeIndex === -1) {
    return [...matches].sort(compareFuzzyMatchQuality)[0] ?? null;
  }

  const active = matches[activeIndex];
  const afterActive = matches.find(
    (match) => match.from > active.from || (match.from === active.from && match.to > active.to)
  );

  return afterActive ?? matches[0];
}

/**
 * Pick the previous fuzzy match for navigation. When the current selection
 * does not overlap any match, jump to the last match before the cursor.
 */
export function pickPreviousFuzzyMatch(
  matches: FuzzyMatch[],
  selectionFrom: number,
  selectionTo: number
): FuzzyMatch | null {
  if (matches.length === 0) return null;

  const from = Math.min(selectionFrom, selectionTo);
  const activeIndex = matches.findIndex((match) =>
    selectionOverlapsFuzzyMatch(selectionFrom, selectionTo, match)
  );

  if (activeIndex === -1) {
    return (
      [...matches].reverse().find((match) => match.to <= from) ?? matches[matches.length - 1]
    );
  }

  const active = matches[activeIndex];
  const beforeActive = [...matches]
    .reverse()
    .find(
      (match) => match.from < active.from || (match.from === active.from && match.to < active.to)
    );

  return beforeActive ?? matches[matches.length - 1];
}
