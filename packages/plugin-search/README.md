# @floatboat/nexus-plugin-search

Search helpers and a CodeMirror search panel for Nexus Editor.

## Usage

```ts
import {
  createSearchPlugin,
  findSearchMatches,
  replaceAllMatches
} from "@floatboat/nexus-plugin-search";

const plugin = createSearchPlugin();

const exact = findSearchMatches("Hello hello", "hello");
const fuzzy = findSearchMatches("Nexus Editor\nplain note", "ne", {
  fuzzy: true,
  sortBy: "score"
});

const nextDoc = replaceAllMatches("Nexus Editor", "ne", "NE", {
  fuzzy: true
});
```

## Match Options

`findSearchMatches(doc, query, options)` supports:

- `caseSensitive`: match exact character casing.
- `wholeWord`: require word boundaries around the final match span.
- `regexp`: treat `query` as a regular expression for exact search.
- `fuzzy`: treat `query` as a literal subsequence and return one best match per line.
- `maxMatches`: cap returned matches after sorting.
- `sortBy`: `"position"` by default, or `"score"` for best fuzzy hits first.

Fuzzy matches include a `score` and `ranges` metadata:

```ts
[
  {
    from: 0,
    to: 2,
    text: "Ne",
    score: 1183,
    ranges: [{ from: 0, to: 2, text: "Ne" }]
  }
]
```

The score favors adjacent characters, word or camel-case boundaries, exact-case matches, short spans, and earlier line positions. Regex replacement capture groups are supported only for non-fuzzy regex search; fuzzy replacement replaces the matched span literally.
