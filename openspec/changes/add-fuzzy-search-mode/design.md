# Design - Fuzzy Search Mode

## Context

`@floatboat/nexus-plugin-search` wraps CodeMirror's search extension with a
Nexus-styled panel and a few pure helpers (`findSearchMatches`,
`replaceAllMatches`) for hosts that want search behaviour outside the editor
view. CodeMirror's built-in query supports literal and regexp matching, but it
does not expose a first-class fuzzy query mode.

Roadmap item #17 asks for fuzzy search and explicitly calls out evaluating an
fzf-like algorithm versus a third-party library. This implementation keeps the
change dependency-free and uses a small ordered-subsequence matcher.

## Goals / Non-Goals

### Goals

- Add fuzzy matching without changing the default literal search behaviour.
- Preserve existing search panel controls and keyboard shortcuts.
- Keep panel input human-readable: the field should show `nxe`, not the
  generated regexp.
- Provide a reusable pure helper API with match offsets, matched indices, and a
  score that host UIs can sort or display later.
- Avoid cross-line fuzzy matches so a short query cannot accidentally span a
  large document section.

### Non-Goals

- Introduce a third-party fuzzy library.
- Replace CodeMirror's search extension or reimplement its navigation state.
- Add ranked result lists or per-character match highlighting to the panel UI.
- Persist search history.

## Decisions

### Decision 1: Dependency-free ordered subsequence matcher

Adopted: a local matcher that scans each line for ordered query characters.
Matches include:

- `from` / `to`: range covering the first through last matched character;
- `text`: the matched document slice;
- `indices`: exact character offsets that satisfied the query;
- `score`: a metadata score rewarding shorter spans, word-boundary hits, and
  contiguous characters.

Rationale:

- The implementation is small enough to audit and test.
- It avoids adding package weight to a focused search plugin.
- The score metadata leaves room for future ranked result UIs without forcing
  the current panel to grow a result list.

### Decision 2: Compile panel fuzzy queries to line-local regexp

Adopted: `createFuzzySearchPattern("nxe")` returns
`n[^\n]{0,16}?x[^\n]{0,16}?e`. The search panel enables CodeMirror `regexp`
mode when the `Fuzzy` checkbox is checked.

Rationale:

- CodeMirror already owns search state, next/previous navigation, selection,
  replacement commands, and match decorations.
- A line-local, bounded-gap regexp keeps fuzzy matches from spanning newlines
  or surfacing very loose long-span matches.
- `escapeRegExp` is applied per query character, so punctuation like `.` or
  `[` is treated as literal input.

Alternative considered: a custom CodeMirror `SearchQuery.getCursor` path.
Rejected for this PR because it would require replacing more of CodeMirror's
search machinery and would make the P2 change much larger.

### Decision 3: Fuzzy mode disables incompatible query toggles

When fuzzy mode is active, the panel disables `Regexp` and `By word`. Fuzzy mode
uses generated regexp internally, and whole-word filtering does not map cleanly
to subsequence ranges such as `nxe` -> `Nexus Editor`.

`Match case` remains active and applies both to the pure fuzzy helper and the
compiled panel query.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Generated regexp could treat user punctuation as syntax | Escape every query character before joining with the fuzzy gap pattern. |
| Fuzzy regexp could span large portions of the document | Use bounded `[^\n]{0,16}?` gaps between characters so panel matching is line-local and compact. |
| `SearchOptions.fuzzy` and `SearchPluginOptions.fuzzy` could be confused | Document the distinction: helper-level per-call override vs plugin-level panel default. |
| Score metadata is unused by the current panel | Keep it documented as host-facing metadata for result list UIs; panel keeps CodeMirror order. |

## Migration Plan

None. All public API additions are optional and default to existing literal
search behaviour.

## Open Questions

- Should a future search result list sort fuzzy matches by `score` rather than
  document order?
- Should fuzzy mode eventually highlight the individual matched indices inside
  each selected range?
