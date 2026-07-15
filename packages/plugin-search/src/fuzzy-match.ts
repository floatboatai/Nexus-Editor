export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

function compareChar(doc: string, index: number, needleChar: string, caseSensitive: boolean): boolean {
  const hayChar = doc[index];
  if (hayChar === undefined) return false;
  return caseSensitive ? hayChar === needleChar : hayChar.toLowerCase() === needleChar.toLowerCase();
}

function isWholeWordSpan(doc: string, from: number, to: number): boolean {
  const before = from === 0 || !/\w/.test(doc[from - 1]!);
  const after = to >= doc.length || !/\w/.test(doc[to]!);
  return before && after;
}

/**
 * Match `query` as an ordered subsequence starting at `start`.
 * The returned span covers the first through last matched characters.
 */
function matchFuzzyFrom(
  doc: string,
  start: number,
  query: string,
  options: FuzzyMatchOptions
): { from: number; to: number; text: string } | null {
  if (!query || start < 0 || start >= doc.length) return null;

  const caseSensitive = options.caseSensitive ?? false;
  if (!compareChar(doc, start, query[0]!, caseSensitive)) return null;

  let queryIndex = 0;
  let lastMatch = start;

  for (let index = start; index < doc.length && queryIndex < query.length; index++) {
    if (!compareChar(doc, index, query[queryIndex]!, caseSensitive)) continue;
    lastMatch = index;
    queryIndex++;
  }

  if (queryIndex < query.length) return null;

  const from = start;
  const to = lastMatch + 1;
  if (options.wholeWord && !isWholeWordSpan(doc, from, to)) return null;

  return {
    from,
    to,
    text: doc.slice(from, to)
  };
}

function dedupeMatches(
  matches: Array<{ from: number; to: number; text: string }>
): Array<{ from: number; to: number; text: string }> {
  const seen = new Set<string>();
  const result: Array<{ from: number; to: number; text: string }> = [];
  for (const match of matches) {
    const key = `${match.from}:${match.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

function normalizeFuzzyMatches(
  matches: Array<{ from: number; to: number; text: string }>
): Array<{ from: number; to: number; text: string }> {
  const sorted = [...matches].sort((left, right) => {
    if (left.from !== right.from) return left.from - right.from;
    return right.to - left.to;
  });

  const result: Array<{ from: number; to: number; text: string }> = [];
  let cursor = 0;
  for (const match of sorted) {
    if (match.from < cursor) continue;
    result.push(match);
    cursor = match.to;
  }
  return result;
}

export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzyMatchOptions = {}
): Array<{ from: number; to: number; text: string }> {
  if (!query) return [];

  const matches: Array<{ from: number; to: number; text: string }> = [];
  for (let start = 0; start < doc.length; start++) {
    const match = matchFuzzyFrom(doc, start, query, options);
    if (match) matches.push(match);
  }

  return normalizeFuzzyMatches(dedupeMatches(matches));
}
