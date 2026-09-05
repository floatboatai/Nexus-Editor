import { fuzzyMatch, FuzzyMatchOptions, FuzzyMatchResult } from './fuzzy-match';

export class DebouncedFuzzySearch {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastQuery: string = '';
  private lastResults: FuzzyMatchResult[] = [];
  private readonly debounceMs: number;
  private readonly maxMatches: number;

  constructor(options: { debounceMs?: number; maxMatches?: number } = {}) {
    this.debounceMs = options.debounceMs ?? 100;
    this.maxMatches = options.maxMatches ?? 100;
  }

  search(
    pattern: string,
    text: string,
    options: FuzzyMatchOptions = {},
    callback: (results: FuzzyMatchResult[]) => void
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (pattern === this.lastQuery) {
      callback(this.lastResults);
      return;
    }

    this.debounceTimer = setTimeout(() => {
      const startTime = performance.now();
      const results = fuzzyMatch(pattern, text, options);
      const endTime = performance.now();

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `Fuzzy search: ${results.length} matches in ${(endTime - startTime).toFixed(2)}ms`
        );
      }

      const limitedResults = results.slice(0, this.maxMatches);
      this.lastQuery = pattern;
      this.lastResults = limitedResults;
      callback(limitedResults);
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  clearCache(): void {
    this.lastQuery = '';
    this.lastResults = [];
  }
}

export class ChunkedFuzzySearch {
  private chunkSize: number;
  private readonly maxChunks: number;

  constructor(options: { chunkSize?: number; maxChunks?: number } = {}) {
    this.chunkSize = options.chunkSize ?? 10000;
    this.maxChunks = options.maxChunks ?? 10;
  }

  async search(
    pattern: string,
    text: string,
    options: FuzzyMatchOptions = {}
  ): Promise<FuzzyMatchResult[]> {
    const results: FuzzyMatchResult[] = [];
    const chunks = this.splitIntoChunks(text);

    for (let i = 0; i < Math.min(chunks.length, this.maxChunks); i++) {
      const chunk = chunks[i];
      const chunkResults = fuzzyMatch(pattern, chunk, options);

      const offset = i * this.chunkSize;
      for (const result of chunkResults) {
        results.push({
          score: result.score,
          indices: result.indices.map((idx) => idx + offset),
        });
      }

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 100);
  }

  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += this.chunkSize) {
      chunks.push(text.slice(i, i + this.chunkSize));
    }
    return chunks;
  }
}

export class MemoizedFuzzySearch {
  private cache = new Map<string, FuzzyMatchResult[]>();
  private readonly maxCacheSize: number;

  constructor(options: { maxCacheSize?: number } = {}) {
    this.maxCacheSize = options.maxCacheSize ?? 100;
  }

  search(pattern: string, text: string, options: FuzzyMatchOptions = {}): FuzzyMatchResult[] {
    const key = this.createCacheKey(pattern, text, options);

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const results = fuzzyMatch(pattern, text, options);

    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, results);
    return results;
  }

  private createCacheKey(pattern: string, text: string, options: FuzzyMatchOptions): string {
    return `${pattern}|${text.length}|${JSON.stringify(options)}`;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
