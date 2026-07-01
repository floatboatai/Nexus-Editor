# @floatboat/nexus-plugin-search

Search, replace, and fuzzy matching for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

- **Find & replace panel** — case-sensitive, whole-word, and regex modes,
  with an opt-in, host-injected query history (no implicit `localStorage`).
- **Pure matching helpers** — `findSearchMatches` / `replaceAllMatches`
  operate on a plain string, so they work in Node, a build script, or a
  Worker without an editor instance.
- **Fuzzy matcher** — `fuzzyMatch` / `fuzzyFilter` rank candidates by
  subsequence match for slash menus, command palettes, and file pickers.

## Install

```bash
pnpm add @floatboat/nexus-plugin-search @floatboat/nexus-core
```

## Search plugin

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  container,
  plugins: [createSearchPlugin({ history: true })]
});
```

`findSearchMatches(doc, query, options)` and
`replaceAllMatches(doc, query, replacement, options)` accept
`{ caseSensitive, wholeWord, regexp }` and find **contiguous** matches.

## Fuzzy matching

Fuzzy matching is different from the find panel: instead of contiguous runs,
it asks whether the query characters appear in the target **in order but not
necessarily adjacent** (`"gcl"` matches `"gamma cluster"`), and returns a
score so candidates can be ranked best-first.

```ts
import { fuzzyMatch, fuzzyFilter } from "@floatboat/nexus-plugin-search";

fuzzyMatch("gamma cluster", "gcl");
// → { score: 83, positions: [0, 6, 7] }   (indices into the target)

fuzzyMatch("Gamma", "g", { caseSensitive: true });
// → null

// Rank a list, best match first; non-matches are dropped.
fuzzyFilter(["Heading 1", "Heading 2", "Code Block"], "head");
// → [{ item: "Heading 1", score, positions }, { item: "Heading 2", ... }]

// Object items via a key extractor, capped to N results.
fuzzyFilter(commands, "img", { key: (c) => c.title, limit: 8 });
```

### Scoring

The score rewards, in order of weight: matches at the start of the target,
consecutive matched characters, and matches right after a word boundary
(space, `-`, `_`, `/`, `.`, `:`, or a camelCase hump). Leading and
intervening gaps are penalized. The magnitude is an implementation detail —
sort on it rather than threshold against a constant.

An empty query is the "menu just opened" case: `fuzzyMatch` returns
`{ score: 0, positions: [] }` and `fuzzyFilter` returns every item in its
original order, so callers don't reorder before the user types.

The matcher runs an `O(query.length × target.length)` dynamic-programming
pass — no backtracking blow-up on pathological repeated-character input.
