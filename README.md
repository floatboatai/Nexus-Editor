# Fuzzy Search Plugin for Nexus Editor

A fuzzy search implementation based on fzf-style subsequence matching with scoring.

## Features

- **Subsequence Matching**: Characters don't need to be adjacent
- **Scoring System**: Higher scores for consecutive matches, word boundaries, and start-of-word matches
- **CJK Support**: Handles Chinese, Japanese, and Korean characters
- **Performance Optimized**: Debounced search, chunked processing for large documents
- **Case Insensitive**: By default (configurable)

## Installation

```bash
pnpm add @floatboat/nexus-plugin-search-fuzzy
```

## Usage

### Basic Usage

```typescript
import { fuzzyMatch, findBestFuzzyMatch } from '@floatboat/nexus-plugin-search-fuzzy';

const results = fuzzyMatch('nxe', 'Nexus-Editor');
const best = findBestFuzzyMatch('nxe', 'Nexus-Editor');
```

### Integration with Editor

```typescript
import { fuzzySearch, toggleFuzzyMode } from '@floatboat/nexus-plugin-search-fuzzy';

const editor = new Editor({
  extensions: [
    fuzzySearch(),
    // ...
  ],
});

editor.dispatch({
  effects: toggleFuzzyMode.of(true),
});
```

### Performance Optimization

```typescript
import { DebouncedFuzzySearch, ChunkedFuzzySearch } from '@floatboat/nexus-plugin-search-fuzzy';

const search = new DebouncedFuzzySearch({ debounceMs: 100 });
search.search('pattern', text, {}, (results) => {
  console.log(results);
});
```

## API Reference

### `fuzzyMatch(pattern, text, options?)`
Returns array of `FuzzyMatchResult` sorted by score (descending).

### `findBestFuzzyMatch(pattern, text, options?)`
Returns the best match or `null`.

### `isFuzzyMatch(pattern, text, options?)`
Returns `true` if pattern matches text.

### `highlightFuzzyMatch(pattern, text, options?)`
Returns array of `{ text, isMatch }` objects for rendering.

### Options
- `caseSensitive`: Enable case-sensitive matching (default: `false`)
- `maxGap`: Maximum allowed gap between matched characters (default: `Infinity`)
- `bonusForConsecutive`: Bonus for consecutive matches (default: `10`)
- `bonusForWordBoundary`: Bonus for word boundary matches (default: `20`)
- `bonusForStartOfWord`: Bonus for start-of-word matches (default: `30`)

## Testing

```bash
pnpm test
```

## License

MIT