export interface FuzzyMatch {
  from: number;
  to: number;
  score: number;
}

interface MatchState {
  score: number;
  from: number;
  to: number;
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
  return candidate.to - candidate.from < current.to - current.from;
}

function matchFrom(text: string, query: string, start: number): FuzzyMatch | null {
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  if (!lowerQuery || start >= text.length || lowerText[start] !== lowerQuery[0]) return null;

  let state: MatchState = {
    score: characterScore(text, start, -1),
    from: start,
    to: start + 1
  };

  for (let queryIndex = 1; queryIndex < lowerQuery.length; queryIndex += 1) {
    const queryChar = lowerQuery[queryIndex];
    let index = state.to;
    let best: MatchState | undefined;

    while (index < text.length) {
      if (lowerText[index] === queryChar) {
        const candidate: MatchState = {
          score:
            state.score +
            characterScore(text, index, state.to - 1) -
            Math.max(0, index - state.to - 1),
          from: state.from,
          to: index + 1
        };
        if (better(candidate, best)) best = candidate;
      }
      index += 1;
    }

    if (!best) return null;
    state = best;
  }

  return { from: state.from, to: state.to, score: state.score };
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
