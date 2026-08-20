# @floatboat/nexus-plugin-search

Search utilities and the CodeMirror search plugin used by Nexus-Editor.

## Fuzzy matching

The package exposes a standalone fuzzy matcher from `@floatboat/nexus-plugin-search/fuzzy`.

```ts
import { findFuzzyMatches } from "@floatboat/nexus-plugin-search/fuzzy";

const matches = findFuzzyMatches("CreateSearchPlugin", "csp");

// The matched characters are available as UTF-16 offsets.
// matches[0].indices === [0, 6, 12]
```

Fuzzy matching is case-insensitive and ranks subsequences using word-boundary and contiguous-character bonuses, with a penalty for gaps. Results are returned in document order and do not overlap.

Each match contains:

- `from` / `to`: the enclosing source range.
- `indices`: the individual character offsets selected by the fuzzy match.
- `score`: the ranking score used by the matcher.

The Electron demo exposes this capability through its **Fuzzy** search toggle. Replacement is intentionally disabled while fuzzy mode is active because fuzzy matches do not define an unambiguous literal replacement target.
