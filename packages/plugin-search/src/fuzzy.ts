export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
  minScore?: number;
  maxDistance?: number;
}

export interface FuzzyMatchRange {
  from: number;
  to: number;
}

export interface FuzzyMatchResult {
  score: number;
  ranges: FuzzyMatchRange[];
  text: string;
}

export interface FuzzySearchCursorMatch {
  from: number;
  to: number;
  score: number;
  ranges: FuzzyMatchRange[];
}

function isWordBoundary(str: string, index: number): boolean {
  if (index === 0) return true;
  const prevChar = str[index - 1];
  const currChar = str[index];
  if (/[\s_\-./\\,]/.test(prevChar)) return true;
  if (/[a-z]/.test(prevChar) && /[A-Z]/.test(currChar)) return true;
  return false;
}

/**
 * Performs fuzzy subsequence matching of a pattern against text.
 * Calculates score based on contiguous matches, word boundaries, and position distance.
 */
export function fuzzyMatch(
  pattern: string,
  text: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult | null {
  if (!pattern || !text) return null;
  if (pattern.length > text.length) return null;

  const caseSensitive = options.caseSensitive ?? false;
  const targetPattern = caseSensitive ? pattern : pattern.toLowerCase();
  const targetText = caseSensitive ? text : text.toLowerCase();

  const patternLen = targetPattern.length;
  const textLen = targetText.length;

  // First quick check: all characters in pattern must exist in targetText in order
  let pIdx = 0;
  for (let tIdx = 0; tIdx < textLen && pIdx < patternLen; tIdx++) {
    if (targetText[tIdx] === targetPattern[pIdx]) {
      pIdx++;
    }
  }
  if (pIdx < patternLen) {
    return null; // Pattern characters not all present in order
  }

  // Find optimal matching alignment using dynamic programming or backtracking
  // For standard search terms (< 100 chars), backtracking with memoization / optimal path search is fast & precise
  const matchedIndices = findBestMatchIndices(targetPattern, targetText, text);
  if (!matchedIndices) return null;

  const score = calculateScore(matchedIndices, targetPattern, targetText, text);
  if (options.minScore !== undefined && score < options.minScore) {
    return null;
  }

  const ranges = indicesToRanges(matchedIndices);
  return {
    score,
    ranges,
    text
  };
}

function findBestMatchIndices(
  pattern: string,
  targetText: string,
  originalText: string
): number[] | null {
  const patternLen = pattern.length;
  const textLen = targetText.length;

  // Best path search
  function searchPath(pIdx: number, tStart: number): { indices: number[]; score: number } | null {
    if (pIdx === patternLen) {
      return { indices: [], score: 0 };
    }

    const char = pattern[pIdx];
    let bestResult: { indices: number[]; score: number } | null = null;

    for (let tIdx = tStart; tIdx < textLen; tIdx++) {
      if (targetText[tIdx] === char) {
        const sub = searchPath(pIdx + 1, tIdx + 1);
        if (sub) {
          const currentIndices = [tIdx, ...sub.indices];
          const currentScore = evaluatePartialScore(currentIndices, pattern, targetText, originalText);
          if (!bestResult || currentScore > bestResult.score) {
            bestResult = { indices: currentIndices, score: currentScore };
          }
        }
      }
    }

    return bestResult;
  }

  const res = searchPath(0, 0);
  return res ? res.indices : null;
}

function evaluatePartialScore(
  indices: number[],
  pattern: string,
  targetText: string,
  originalText: string
): number {
  let score = 0;
  let contiguousRun = 0;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    score += 10; // Base match score

    // Word boundary bonus
    if (isWordBoundary(originalText, idx)) {
      score += 25;
    }

    // Exact case match bonus
    if (pattern[i] === originalText[idx]) {
      score += 5;
    }

    // Contiguous match bonus
    if (i > 0 && idx === indices[i - 1] + 1) {
      contiguousRun++;
      score += 15 + contiguousRun * 5;
    } else {
      contiguousRun = 0;
      if (i > 0) {
        // Distance penalty
        const gap = idx - indices[i - 1] - 1;
        score -= Math.min(gap * 3, 20);
      }
    }
  }

  // Start position penalty (prefer matches near start)
  if (indices.length > 0) {
    score -= Math.min(indices[0] * 2, 30);
  }

  return score;
}

function calculateScore(
  indices: number[],
  pattern: string,
  targetText: string,
  originalText: string
): number {
  return evaluatePartialScore(indices, pattern, targetText, originalText);
}

export function indicesToRanges(indices: number[]): FuzzyMatchRange[] {
  if (indices.length === 0) return [];
  const ranges: FuzzyMatchRange[] = [];
  let from = indices[0];
  let to = indices[0] + 1;

  for (let i = 1; i < indices.length; i++) {
    const idx = indices[i];
    if (idx === to) {
      to++;
    } else {
      ranges.push({ from, to });
      from = idx;
      to = idx + 1;
    }
  }
  ranges.push({ from, to });
  return ranges;
}

/**
 * Creates a cursor to iterate over fuzzy matches in a CodeMirror Text document.
 */
export function createFuzzySearchCursor(
  doc: { toString(): string } | string,
  pattern: string,
  options: FuzzyMatchOptions = {}
): { next(): { value: FuzzySearchCursorMatch | null; done: boolean } } {
  const content = typeof doc === "string" ? doc : doc.toString();
  const patternTrimmed = pattern.trim();
  let searched = false;
  let matches: FuzzySearchCursorMatch[] = [];
  let matchIndex = 0;

  if (patternTrimmed && content) {
    // Break content by lines to compute line-level fuzzy matches with line offsets
    const lineBreakRegex = /\r?\n/g;
    let lineStart = 0;
    let match;

    const lines: { text: string; from: number }[] = [];
    while ((match = lineBreakRegex.exec(content)) !== null) {
      lines.push({ text: content.slice(lineStart, match.index), from: lineStart });
      lineStart = match.index + match[0].length;
    }
    lines.push({ text: content.slice(lineStart), from: lineStart });

    for (const line of lines) {
      const result = fuzzyMatch(patternTrimmed, line.text, options);
      if (result) {
        const absoluteRanges = result.ranges.map((r) => ({
          from: line.from + r.from,
          to: line.from + r.to
        }));
        const overallFrom = line.from + result.ranges[0].from;
        const overallTo = line.from + result.ranges[result.ranges.length - 1].to;

        matches.push({
          from: overallFrom,
          to: overallTo,
          score: result.score,
          ranges: absoluteRanges
        });
      }
    }
  }

  return {
    next() {
      if (!searched) {
        searched = true;
      }
      if (matchIndex < matches.length) {
        const value = matches[matchIndex++];
        return { value, done: false };
      }
      return { value: null, done: true };
    }
  };
}
