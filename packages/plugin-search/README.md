# @floatboat/nexus-plugin-search

Search panel and programmatic search/replace helpers for Nexus Editor.

## Usage

```ts
import {
  createSearchPlugin,
  findSearchMatches,
  replaceAllMatches
} from "@floatboat/nexus-plugin-search";

const searchPlugin = createSearchPlugin({
  caseSensitive: true
});
```

## Options

### `createSearchPlugin(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `top` | `boolean` | `true` | Render the search panel above the editor content. |
| `caseSensitive` | `boolean` | `false` | Enable case-sensitive search by default. |
| `highlightSelectionMatches` | `boolean` | `true` | Highlight viewport matches for the current selection. |
| `labels` | `Partial<SearchPluginLabels>` | `undefined` | Override search panel labels. |

### `findSearchMatches(doc, query, options)`

Returns all matches for `query`. Searches are case-insensitive and literal by default.

Pass `{ fuzzy: true }` to interpret `query` as an ordered subsequence. Fuzzy search returns the smallest contiguous, line-local text window containing the query characters in order:

```ts
findSearchMatches("Nexus Editor", "nxed", { fuzzy: true });
// [{ from: 0, to: 8, text: "Nexus Ed" }]
```

Fuzzy search does not match across line breaks. Combine with `{ caseSensitive: true }` to require exact character casing.

### `replaceAllMatches(doc, query, replacement, options)`

Replaces every match in `doc`. Literal replacement is used by default.

With `{ fuzzy: true }`, replacement applies to each fuzzy match window:

```ts
replaceAllMatches("Nexus Ed note", "nxed", "Match", { fuzzy: true });
// "Match note"
```
