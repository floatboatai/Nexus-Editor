export interface FuzzySearchOptions {
  caseSensitive?: boolean;
}

function charsEqual(left: string, right: string, caseSensitive: boolean): boolean {
  return caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
}

/**
 * Find the shortest subsequence match for `query` when the first query character
 * must align at `start` in `doc`.
 */
function findShortestFuzzyMatchFrom(
  doc: string,
  query: string,
  start: number,
  caseSensitive: boolean
): { from: number; to: number; text: string } | null {
  if (!query || start >= doc.length) return null;
  if (!charsEqual(doc[start], query[0], caseSensitive)) return null;

  let queryIndex = 1;
  let lastMatchIndex = start;

  for (let docIndex = start + 1; docIndex < doc.length && queryIndex < query.length; docIndex++) {
    if (charsEqual(doc[docIndex], query[queryIndex], caseSensitive)) {
      lastMatchIndex = docIndex;
      queryIndex++;
    }
  }

  if (queryIndex < query.length) return null;

  const from = start;
  const to = lastMatchIndex + 1;
  return { from, to, text: doc.slice(from, to) };
}

function selectNonOverlappingMatches(
  matches: { from: number; to: number; text: string }[]
): { from: number; to: number; text: string }[] {
  const sorted = [...matches].sort((left, right) => left.from - right.from || left.to - right.to);
  const selected: { from: number; to: number; text: string }[] = [];
  let occupiedUntil = 0;

  for (const match of sorted) {
    if (match.from < occupiedUntil) continue;
    selected.push(match);
    occupiedUntil = match.to;
  }

  return selected;
}

/**
 * Find fuzzy (subsequence) matches in `doc`.
 * Each match starts where the first query character aligns and uses the shortest completing span.
 */
export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzySearchOptions = {}
): { from: number; to: number; text: string }[] {
  if (!query) return [];

  const caseSensitive = options.caseSensitive ?? false;
  const candidates: { from: number; to: number; text: string }[] = [];

  for (let start = 0; start < doc.length; start++) {
    const match = findShortestFuzzyMatchFrom(doc, query, start, caseSensitive);
    if (match) candidates.push(match);
  }

  return selectNonOverlappingMatches(candidates);
}

/**
 * Build a regex alternation pattern from fuzzy match texts for CodeMirror search integration.
 */
export function buildFuzzyAlternationPattern(
  matches: { from: number; to: number; text: string }[]
): string | null {
  if (matches.length === 0) return null;

  const uniqueTexts = [...new Set(matches.map((match) => match.text))];
  return uniqueTexts.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}
