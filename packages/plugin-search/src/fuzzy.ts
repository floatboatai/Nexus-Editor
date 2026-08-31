export interface FuzzyMatch {
  from: number;
  to: number;
  text: string;
  score: number;
  positions: number[];
}

export interface FuzzySearchOptions {
  caseSensitive?: boolean;
  limit?: number;
}

const FUZZY_DEFAULT_LIMIT = 50;

function isFuzzyWordBoundary(text: string, pos: number): boolean {
  if (pos <= 0) return true;
  return /[\s\-_./\\]/.test(text[pos - 1]);
}

function scoreFuzzyMatch(text: string, positions: number[]): number {
  if (positions.length === 0) return 0;

  let score = 0;
  let prevPos = -1;
  let consecutiveRun = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    score += 1;

    if (prevPos !== -1 && pos === prevPos + 1) {
      consecutiveRun++;
      score += 5 + consecutiveRun;
    } else {
      consecutiveRun = 0;
      if (prevPos !== -1) {
        score -= (pos - prevPos - 1) * 0.5;
      }
    }

    if (i === 0) {
      if (isFuzzyWordBoundary(text, pos)) {
        score += 8;
      }
      if (pos === 0) {
        score += 10;
      }
    }

    prevPos = pos;
  }

  return score;
}

function findFuzzyMatchPositions(text: string, query: string, start: number): number[] | null {
  const positions: number[] = [];
  let cursor = start;

  for (let qi = 0; qi < query.length; qi++) {
    const found = text.indexOf(query[qi], cursor);
    if (found === -1) return null;
    positions.push(found);
    cursor = found + 1;
  }

  return positions;
}

export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzySearchOptions = {}
): FuzzyMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const text = options.caseSensitive ? doc : doc.toLowerCase();
  const needle = options.caseSensitive ? trimmed : trimmed.toLowerCase();
  if (needle.length > text.length) return [];

  const limit = options.limit ?? FUZZY_DEFAULT_LIMIT;
  const matches: FuzzyMatch[] = [];

  for (let start = 0; start <= text.length - needle.length; start++) {
    if (text[start] !== needle[0]) continue;

    const positions = findFuzzyMatchPositions(text, needle, start);
    if (!positions) continue;

    const from = positions[0];
    const to = positions[positions.length - 1] + 1;
    const score = scoreFuzzyMatch(text, positions);

    matches.push({
      from,
      to,
      text: doc.slice(from, to),
      score,
      positions
    });
  }

  matches.sort((a, b) => b.score - a.score || a.from - b.from);

  return limit > 0 ? matches.slice(0, limit) : matches;
}
