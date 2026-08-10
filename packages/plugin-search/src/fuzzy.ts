export interface FuzzyMatch {
  from: number;
  to: number;
  score: number;
  /** UTF-16 offsets of the characters selected by the fuzzy match. */
  indices: number[];
}

interface MatchState {
  score: number;
  from: number;
  last: number;
  previous?: MatchState;
}

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  const current = text[index];
  return /[\p{L}\p{N}_]/u.test(current) && !/[\p{L}\p{N}_]/u.test(previous);
}

function characterScore(text: string, index: number, previousIndex: number): number {
  let score = 1;
  if (isWordBoundary(text, index)) score += 5;
  if (previousIndex >= 0 && index === previousIndex + 1) score += 4;
  if (index === 0) score += 3;
  return score;
}

function better(candidate: MatchState, current: MatchState | undefined): boolean {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  return candidate.last - candidate.from < current.last - current.from;
}

function collectIndices(state: MatchState): number[] {
  const indices: number[] = [];
  let current: MatchState | undefined = state;

  while (current) {
    indices.push(current.last);
    current = current.previous;
  }

  indices.reverse();
  return indices;
}

/**
 * Find the highest-scoring subsequence beginning at `start`.
 * The dynamic program keeps the best predecessor score for each query
 * character, so the result is not dependent on a greedy character choice.
 */
function matchFrom(text: string, query: string, start: number): FuzzyMatch | null {
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  if (!lowerQuery || start >= text.length || lowerText[start] !== lowerQuery[0]) return null;

  let states: Array<MatchState | undefined> = Array(text.length).fill(undefined);
  states[start] = {
    score: characterScore(text, start, -1),
    from: start,
    last: start
  };

  for (let queryIndex = 1; queryIndex < lowerQuery.length; queryIndex += 1) {
    const next: Array<MatchState | undefined> = Array(text.length).fill(undefined);
    let bestPredecessor: MatchState | undefined;
    let bestPredecessorValue = Number.NEGATIVE_INFINITY;
    const queryChar = lowerQuery[queryIndex];

    for (let index = start + 1; index < text.length; index += 1) {
      const predecessor = states[index - 1];
      if (predecessor) {
        const value = predecessor.score + predecessor.last;
        if (value > bestPredecessorValue) {
          bestPredecessor = predecessor;
          bestPredecessorValue = value;
        }
      }

      if (lowerText[index] !== queryChar || !bestPredecessor) continue;

      const gapPenalty = index - bestPredecessor.last - 1;
      next[index] = {
        score:
          bestPredecessor.score +
          characterScore(text, index, bestPredecessor.last) -
          gapPenalty,
        from: bestPredecessor.from,
        last: index,
        previous: bestPredecessor
      };
    }

    states = next;
  }

  let best: MatchState | undefined;
  for (const state of states) {
    if (state && better(state, best)) best = state;
  }

  if (!best) return null;
  return {
    from: best.from,
    to: best.last + 1,
    score: best.score,
    indices: collectIndices(best)
  };
}

/**
 * Find all non-overlapping fuzzy subsequence matches in document order.
 * Matches favor word boundaries and contiguous characters, while penalizing gaps.
 */
export function findFuzzyMatches(text: string, query: string): FuzzyMatch[] {
  if (!text || !query) return [];

  const lowerText = text.toLocaleLowerCase();
  const lowerFirst = query.toLocaleLowerCase()[0];
  const matches: FuzzyMatch[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = lowerText.indexOf(lowerFirst, cursor);
    if (start === -1) break;

    const match = matchFrom(text, query, start);
    if (match) {
      matches.push(match);
      cursor = match.to;
    } else {
      cursor = start + 1;
    }
  }

  return matches;
}
