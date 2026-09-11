# `@floatboat/nexus-plugin-search`

A search panel plugin for Nexus-Editor, built on top of
[`@codemirror/search`](https://codemirror.net/docs/ref/). Adds a UI panel,
query history, and a fuzzy-matching mode on top of the upstream
CodeMirror search behavior.

## Install

```ts
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

createEditor({
  container,
  initialValue: "# hello",
  plugins: [createSearchPlugin()]
});
```

## Options

```ts
createSearchPlugin({
  top?: boolean; // render the panel above the editor (default true)
  caseSensitive?: boolean; // default case-insensitive
  highlightSelectionMatches?: boolean; // default true
  history?: boolean | SearchHistoryOptions; // opt-in history
  labels?: Partial<SearchPluginLabels>; // localize UI strings
});
```

`SearchHistoryOptions`:

```ts
interface SearchHistoryOptions {
  storage?: SearchHistoryStorage; // host-injected; falls back to no-op
  storageKey?: string; // default "nexus.search.history"
  maxEntries?: number; // default 20
}
```

`SearchHistoryStorage` is a small interface (`getItem` / `setItem` /
optional `removeItem`) that the host wires up to localStorage, an Electron
userData path, or a remote sync layer. The plugin never touches
`window.localStorage` directly — this matches the project-wide "host
provides storage" rule for the slash-command history plugin.

## Fuzzy search

The panel exposes a **Fuzzy** toggle (default off). When enabled, the
plugin dispatches a `FuzzySearchQuery` (a `SearchQuery` subclass) instead
of the regular literal query. Fuzzy mode:

- matches query characters as a subsequence, not a substring;
- prefers tight windows (matches that span less surrounding text);
- rewards word-boundary starts and consecutive characters;
- rejects matches where the gap between consecutive matched characters
  exceeds `maxGap` (default `32`).

Regexp and whole-word options are intentionally ignored in fuzzy mode —
they make sense only for substring/regex matching. The checkboxes stay
visible so a toggle back to literal mode restores the previous state.

### Public API

The fuzzy matcher is also exported as a standalone helper for tools
(side panels, command palettes, link pickers) that want the same
behavior without a CodeMirror editor:

```ts
import { fuzzyFindMatches } from "@floatboat/nexus-plugin-search";

const hits = fuzzyFindMatches(text, query, {
  caseSensitive: false,
  maxGap: 32
});
// → Array<{ from, to, text, positions, score }>
```

`FuzzySearchQuery` is exported for advanced consumers that want to drop
the query directly into a custom CodeMirror `EditorState` (e.g. a
preview pane that needs to call `getCursor(state)` itself).
