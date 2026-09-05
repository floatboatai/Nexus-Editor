/**
 * Fuzzy matching algorithm (fzf-style subsequence matching with scoring)
 *
 * Features:
 * - Subsequence matching (characters don't need to be adjacent)
 * - Scoring based on match quality (consecutive matches, word boundaries, etc.)
 * - CJK character support
 * - Performance optimized for large documents
 */

export interface FuzzyMatchResult {
  score: number;
  indices: number[];
}

export interface FuzzyMatchOptions {
  caseSensitive?: boolean;
  maxGap?: number;
  bonusForConsecutive?: number;
  bonusForWordBoundary?: number;
  bonusForStartOfWord?: number;
}

const DEFAULT_OPTIONS: FuzzyMatchOptions = {
  caseSensitive: false,
  maxGap: Infinity,
  bonusForConsecutive: 10,
  bonusForWordBoundary: 20,
  bonusForStartOfWord: 30,
};

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f)
  );
}

function isWordBoundary(char: string, prevChar?: string): boolean {
  if (!prevChar) return true;
  if (isCJK(char) || isCJK(prevChar)) return true;
  if (/\s/.test(prevChar) && !/\s/.test(char)) return true;
  if (/[a-z]/.test(prevChar) && /[A-Z]/.test(char)) return true;
  if (/[^a-zA-Z0-9]/.test(prevChar) && /[a-zA-Z0-9]/.test(char)) return true;
  return false;
}

export function fuzzyMatch(
  pattern: string,
  text: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: FuzzyMatchResult[] = [];

  if (!pattern || !text) return results;

  const patternChars = opts.caseSensitive ? pattern.split('') : pattern.toLowerCase().split('');
  const textChars = opts.caseSensitive ? text.split('') : text.toLowerCase().split('');

  for (let startIdx = 0; startIdx <= textChars.length - patternChars.length; startIdx++) {
    const matchResult = tryMatchAtPosition(patternChars, textChars, startIdx, opts);
    if (matchResult) {
      results.push({
        score: matchResult.score,
        indices: matchResult.indices,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function tryMatchAtPosition(
  patternChars: string[],
  textChars: string[],
  startIdx: number,
  options: FuzzyMatchOptions
): { score: number; indices: number[] } | null {
  const indices: number[] = [];
  let score = 0;
  let lastMatchIdx = -1;
  let patternIdx = 0;
  let textIdx = startIdx;

  while (patternIdx < patternChars.length && textIdx < textChars.length) {
    if (lastMatchIdx !== -1 && textIdx - lastMatchIdx > (options.maxGap ?? Infinity)) {
      return null;
    }

    if (patternChars[patternIdx] === textChars[textIdx]) {
      indices.push(textIdx);

      if (lastMatchIdx !== -1 && textIdx === lastMatchIdx + 1) {
        score += options.bonusForConsecutive ?? 10;
      }

      if (textIdx === 0 || isWordBoundary(textChars[textIdx], textChars[textIdx - 1])) {
        score += options.bonusForWordBoundary ?? 20;
      }

      if (textIdx === 0 || /\s/.test(textChars[textIdx - 1])) {
        score += options.bonusForStartOfWord ?? 30;
      }

      score += 1;
      lastMatchIdx = textIdx;
      patternIdx++;
    }

    textIdx++;
  }

  if (patternIdx !== patternChars.length) {
    return null;
  }

  return { score, indices };
}

export function findBestFuzzyMatch(
  pattern: string,
  text: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult | null {
  const results = fuzzyMatch(pattern, text, options);
  return results.length > 0 ? results[0] : null;
}

export function isFuzzyMatch(
  pattern: string,
  text: string,
  options: FuzzyMatchOptions = {}
): boolean {
  return fuzzyMatch(pattern, text, options).length > 0;
}

export function highlightFuzzyMatch(
  pattern: string,
  text: string,
  options: FuzzyMatchOptions = {}
): Array<{ text: string; isMatch: boolean }> {
  const result = findBestFuzzyMatch(pattern, text, options);
  if (!result) {
    return [{ text, isMatch: false }];
  }

  const highlighted: Array<{ text: string; isMatch: boolean }> = [];
  let lastIdx = 0;

  for (const idx of result.indices) {
    if (idx > lastIdx) {
      highlighted.push({
        text: text.slice(lastIdx, idx),
        isMatch: false,
      });
    }
    highlighted.push({
      text: text[idx],
      isMatch: true,
    });
    lastIdx = idx + 1;
  }

  if (lastIdx < text.length) {
    highlighted.push({
      text: text.slice(lastIdx),
      isMatch: false,
    });
  }

  return highlighted;
}
