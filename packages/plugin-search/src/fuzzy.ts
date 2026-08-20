import type { SearchMatch, SearchOptions } from "./index";

export interface FuzzyResult {
  /**
   * Higher is a better match. Rewards consecutive runs, word-boundary starts,
   * and start-of-string hits; penalizes long spans so tighter matches win.
   */
  score: number;
  /** Indices into `text` that participated in the subsequence match. */
  positions: number[];
}

/**
 * Subsequence fuzzy match: every character of `query` must appear in `text`
 * in order, but not necessarily contiguously (fzf-style). Returns `null` when
 * `query` is empty or any character cannot be matched.
 */
export function fuzzyMatch(query: string, text: string, caseSensitive = false): FuzzyResult | null {
  if (!query) return null;

  const q = caseSensitive ? query : query.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let queryIndex = 0;
  let previousMatch = -2;
  let consecutive = 0;

  for (let i = 0; i < t.length && queryIndex < q.length; i++) {
    if (t[i] !== q[queryIndex]) continue;

    positions.push(i);

    let bonus = 1;
    if (i === 0) bonus += 10;
    const prevChar = i > 0 ? t[i - 1] : "";
    const atBoundary =
      prevChar === "" ||
      prevChar === " " ||
      prevChar === "-" ||
      prevChar === "_" ||
      prevChar === "/" ||
      prevChar === "." ||
      prevChar === ":";
    if (atBoundary) bonus += 4;
    if (i === previousMatch + 1) {
      consecutive += 1;
      bonus += consecutive * 8;
    } else {
      consecutive = 0;
    }

    score += bonus;
    previousMatch = i;
    queryIndex += 1;
  }

  if (queryIndex < q.length) return null;

  score -= Math.max(0, text.length - q.length) * 0.05;
  return { score, positions };
}

/**
 * Find fuzzy matches across a document. Matching is evaluated per line so a
 * match span never crosses a newline; the returned range covers the first to
 * last matched character on the matching line.
 */
export function findFuzzyMatches(doc: string, query: string, options: SearchOptions = {}): SearchMatch[] {
  if (!query) return [];

  const matches: SearchMatch[] = [];
  const lines = doc.split("\n");
  let lineStart = 0;

  for (const line of lines) {
    const result = fuzzyMatch(query, line, options.caseSensitive);
    if (result) {
      const from = lineStart + result.positions[0];
      const to = lineStart + result.positions[result.positions.length - 1] + 1;
      matches.push({ from, to, text: doc.slice(from, to) });
    }
    lineStart += line.length + 1;
  }

  return matches;
}
