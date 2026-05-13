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
  regexp: true,
  caseSensitive: true
});
```

## Options

### `createSearchPlugin(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `top` | `boolean` | `true` | Render the search panel above the editor content. |
| `caseSensitive` | `boolean` | `false` | Enable case-sensitive search by default. |
| `regexp` | `boolean` | `false` | Enable regular expression search by default. When enabled, the CodeMirror search configuration uses regex semantics instead of literal search. |
| `highlightSelectionMatches` | `boolean` | `true` | Highlight viewport matches for the current selection. |
| `labels` | `Partial<SearchPluginLabels>` | `undefined` | Override search panel labels. |

### `findSearchMatches(doc, query, options)`

Returns all matches for `query`. Searches are case-insensitive and literal by default.

Pass `{ regexp: true }` to interpret `query` as a JavaScript regular expression:

```ts
findSearchMatches("hello hullo", "h.llo", { regexp: true });
```

Invalid regular expressions are treated as no matches and emit a `console.warn`.

### `replaceAllMatches(doc, query, replacement, options)`

Replaces every match in `doc`. Literal replacement is used by default.

With `{ regexp: true }`, replacement strings support JavaScript replacement syntax such as capture groups:

```ts
replaceAllMatches("width=10", "(\\w+)=(\\d+)", "$1: $2", { regexp: true });
```

Invalid regular expressions return the original document and emit a `console.warn`.
