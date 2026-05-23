# @floatboat/nexus-plugin-search

CodeMirror-backed search and replace for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

The package provides:

- a Nexus-styled search panel opened through the standard CodeMirror search
  keymap (`Mod-f`, `F3`, `Mod-g`, etc.);
- pure helpers for literal, fuzzy, and replacement operations;
- stable `data-test-id` selectors for host automation.

## Install

```bash
pnpm add @floatboat/nexus-plugin-search @floatboat/nexus-core
```

## Enable the plugin

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  container,
  initialValue: "# Nexus Editor\n\nSearch this document...",
  plugins: [createSearchPlugin()],
});
```

## Fuzzy search mode

Fuzzy search treats the query as an ordered subsequence. For example, `nxe`
matches `Nexus Editor` because the characters `n`, `x`, and `e` appear in that
order.

Enable fuzzy mode by default in the panel:

```ts
createEditor({
  container,
  plugins: [
    createSearchPlugin({
      fuzzy: true,
    }),
  ],
});
```

When the panel's `Fuzzy` checkbox is active, the input still shows the raw user
query (`nxe`). Internally the plugin compiles it to a safe line-local regular
expression such as `n[^\n]{0,16}?x[^\n]{0,16}?e` so CodeMirror can keep
handling navigation, selection, and match highlighting without surfacing very
loose long-span matches.

Fuzzy mode disables the `Regexp` and `By word` toggles because those options do
not map cleanly to subsequence ranges. `Match case` remains available.

## Pure helpers

```ts
import {
  createFuzzySearchPattern,
  findFuzzySearchMatches,
  findSearchMatches,
  replaceAllMatches,
} from "@floatboat/nexus-plugin-search";

findSearchMatches("Hello hello", "hello");
// [{ from: 0, to: 5, text: "Hello" }, { from: 6, to: 11, text: "hello" }]

findSearchMatches("Nexus Editor", "nxe", { fuzzy: true });
// [{ from: 0, to: 7, text: "Nexus E", indices: [0, 2, 6], score: ... }]

findFuzzySearchMatches("Nexus Editor", "nxe", { caseSensitive: false });

createFuzzySearchPattern("n.e");
// "n[^\\n]{0,16}?\\.[^\\n]{0,16}?e"

replaceAllMatches("cat scatter cat", "cat", "dog");
// "dog sdogter dog"
```

## Option scopes

`SearchPluginOptions.fuzzy` and `SearchOptions.fuzzy` intentionally have the
same name but apply at different layers:

| Option | Where it applies | Purpose |
|---|---|---|
| `SearchPluginOptions.fuzzy` | `createSearchPlugin({ fuzzy })` | Sets the search panel's default fuzzy checkbox state. |
| `SearchOptions.fuzzy` | `findSearchMatches(doc, query, { fuzzy })` | Chooses fuzzy matching for a single helper call. |

## API reference

| Export | Purpose |
|---|---|
| `createSearchPlugin(options?)` | Create the CodeMirror-backed Nexus search plugin. |
| `findSearchMatches(doc, query, options?)` | Find literal matches by default, or fuzzy matches when `options.fuzzy` is true. |
| `findFuzzySearchMatches(doc, query, options?)` | Find ordered-subsequence matches with `indices` and `score` metadata. |
| `createFuzzySearchPattern(query)` | Compile a raw fuzzy query to a line-local escaped regexp pattern. |
| `replaceAllMatches(doc, query, replacement, options?)` | Replace all literal matches in a string. |
| `SearchMatch` | Basic `{ from, to, text }` match shape. |
| `FuzzySearchMatch` | Extends `SearchMatch` with `indices` and `score`. |
| `SearchPluginOptions` | Panel options: `top`, `caseSensitive`, `fuzzy`, `highlightSelectionMatches`, `labels`. |

See [`docs/ROADMAP.md`](../../docs/ROADMAP.md) item #17 and
[`openspec/changes/add-fuzzy-search-mode`](../../openspec/changes/add-fuzzy-search-mode)
for the change proposal.
