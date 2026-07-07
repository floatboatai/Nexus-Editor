# @floatboat/nexus-plugin-search

Search panel integration and headless search helpers for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

## Install

```bash
pnpm add @floatboat/nexus-plugin-search @floatboat/nexus-core
```

## Editor plugin

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  container,
  plugins: [createSearchPlugin()]
});
```

The plugin registers CodeMirror's search panel with Nexus styling,
test-friendly attributes, optional query history, replace controls,
case-sensitive search, regular expressions, and whole-word matching.

## Headless helpers

```ts
import { findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

findSearchMatches("Nexus note next", "ne", { fuzzy: true });
// [
//   { from: 0, to: 2, text: "Ne" },
//   { from: 6, to: 10, text: "note" },
//   { from: 11, to: 13, text: "ne" }
// ]

replaceAllMatches("Nexus note next", "ne", "X", { fuzzy: true });
// "Xxus X Xxt"
```

`fuzzy: true` applies to literal searches only. It treats the query as
an ordered subsequence, returns non-overlapping ranges, honors
`caseSensitive` and `wholeWord`, and is ignored when `regexp` is true
so regular-expression behavior stays unchanged.

## API

| Export | Purpose |
|---|---|
| `createSearchPlugin(options?)` | Registers the editor search panel. |
| `findSearchMatches(doc, query, options?)` | Returns match ranges for literal, regexp, whole-word, or fuzzy search. |
| `replaceAllMatches(doc, query, replacement, options?)` | Replaces every supported match and returns the next document. |

## License

MIT
