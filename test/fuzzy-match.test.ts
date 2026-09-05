import { describe, it, expect } from 'vitest';
import {
  fuzzyMatch,
  findBestFuzzyMatch,
  isFuzzyMatch,
  highlightFuzzyMatch,
} from '../src/fuzzy-match';

describe('fuzzyMatch', () => {
  it('should find exact matches', () => {
    const results = fuzzyMatch('abc', 'abc');
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].indices).toEqual([0, 1, 2]);
  });

  it('should find subsequence matches', () => {
    const results = fuzzyMatch('abc', 'a1b2c3');
    expect(results).toHaveLength(1);
    expect(results[0].indices).toEqual([0, 2, 4]);
  });

  it('should handle case insensitivity by default', () => {
    const results = fuzzyMatch('abc', 'ABC');
    expect(results).toHaveLength(1);
    expect(results[0].indices).toEqual([0, 1, 2]);
  });

  it('should handle case sensitivity when enabled', () => {
    const results = fuzzyMatch('abc', 'ABC', { caseSensitive: true });
    expect(results).toHaveLength(0);
  });

  it('should give higher scores to consecutive matches', () => {
    const consecutive = fuzzyMatch('abc', 'abc');
    const scattered = fuzzyMatch('abc', 'a1b2c3');
    expect(consecutive[0].score).toBeGreaterThan(scattered[0].score);
  });

  it('should handle CJK characters', () => {
    const results = fuzzyMatch('你好', '你好世界');
    expect(results).toHaveLength(1);
    expect(results[0].indices).toEqual([0, 1]);
  });

  it('should handle empty inputs', () => {
    expect(fuzzyMatch('', 'abc')).toHaveLength(0);
    expect(fuzzyMatch('abc', '')).toHaveLength(0);
    expect(fuzzyMatch('', '')).toHaveLength(0);
  });

  it('should find multiple matches', () => {
    const results = fuzzyMatch('ab', 'ababab');
    expect(results.length).toBeGreaterThan(1);
  });

  it('should respect maxGap option', () => {
    const results = fuzzyMatch('abc', 'a123456789b123456789c', {
      maxGap: 5,
    });
    expect(results).toHaveLength(0);
  });
});

describe('findBestFuzzyMatch', () => {
  it('should return the best match', () => {
    const result = findBestFuzzyMatch('abc', 'xabcxabc');
    expect(result).not.toBeNull();
    expect(result!.indices[0]).toBe(1);
  });

  it('should return null when no match', () => {
    const result = findBestFuzzyMatch('xyz', 'abc');
    expect(result).toBeNull();
  });
});

describe('isFuzzyMatch', () => {
  it('should return true for matches', () => {
    expect(isFuzzyMatch('abc', 'abc')).toBe(true);
    expect(isFuzzyMatch('abc', 'a1b2c3')).toBe(true);
  });

  it('should return false for non-matches', () => {
    expect(isFuzzyMatch('abc', 'xyz')).toBe(false);
    expect(isFuzzyMatch('abc', 'ab')).toBe(false);
  });
});

describe('highlightFuzzyMatch', () => {
  it('should highlight matched characters', () => {
    const result = highlightFuzzyMatch('abc', 'a1b2c3');
    expect(result).toEqual([
      { text: 'a', isMatch: true },
      { text: '1', isMatch: false },
      { text: 'b', isMatch: true },
      { text: '2', isMatch: false },
      { text: 'c', isMatch: true },
      { text: '3', isMatch: false },
    ]);
  });

  it('should return original text when no match', () => {
    const result = highlightFuzzyMatch('xyz', 'abc');
    expect(result).toEqual([{ text: 'abc', isMatch: false }]);
  });

  it('should handle consecutive matches', () => {
    const result = highlightFuzzyMatch('abc', 'abc');
    expect(result).toEqual([
      { text: 'a', isMatch: true },
      { text: 'b', isMatch: true },
      { text: 'c', isMatch: true },
    ]);
  });
});