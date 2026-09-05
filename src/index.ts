// Main exports
export { fuzzyMatch, findBestFuzzyMatch, isFuzzyMatch, highlightFuzzyMatch } from './fuzzy-match';

export type { FuzzyMatchResult, FuzzyMatchOptions } from './fuzzy-match';

export { fuzzySearch, toggleFuzzyMode } from './plugin-search-fuzzy';

export {
  DebouncedFuzzySearch,
  ChunkedFuzzySearch,
  MemoizedFuzzySearch,
} from './fuzzy-search-optimized';

export { FuzzySearchToggle } from './FuzzySearchToggle';
