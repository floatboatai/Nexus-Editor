# Plugin Search Spec

## ADDED Requirements

### Requirement: SearchOptions supports a fuzzy flag

`SearchOptions` SHALL include an optional `fuzzy?: boolean`. When `true` (and
`regexp` is not `true`), `findSearchMatches` / `replaceAllMatches` SHALL perform
ordered-subsequence matching instead of literal matching.

- When `fuzzy` is absent or `false`, behaviour SHALL be unchanged (literal /
  whole-word / regexp as before).
- When `regexp` is `true`, `fuzzy` SHALL be ignored.

#### Scenario: Per-line fuzzy find
- **WHEN** `findSearchMatches("foo bar\nbaz qux", "fb", { fuzzy: true })` is called
- **THEN** it SHALL return one match `{ from: 0, to: 5, text: "foo b" }` — the
  line that contains `f`…`b` as a subsequence, spanned from first to last
  matched character.

#### Scenario: No subsequence on any line
- **WHEN** `findSearchMatches("foo bar\nbaz qux", "zzz", { fuzzy: true })` is called
- **THEN** it SHALL return `[]`

#### Scenario: Literal fallback when fuzzy is not requested
- **WHEN** `findSearchMatches("foo bar", "bar", {})` is called
- **THEN** it SHALL return `[{ from: 4, to: 7, text: "bar" }]`

#### Scenario: Regexp overrides fuzzy
- **WHEN** `findSearchMatches("foo bar", "f.", { fuzzy: true, regexp: true })`
  is called
- **THEN** it SHALL match the literal regexp `f.` → `[{ from: 0, to: 2, text: "fo" }]`

### Requirement: fuzzy replace preserves unmatched characters

`replaceAllMatches(doc, query, replacement, { fuzzy: true })` SHALL replace
**only the matched characters** on each matching line with `replacement`,
leaving the characters between matched positions intact.

#### Scenario: Replace matched characters only
- **WHEN** `replaceAllMatches("foo bar", "fb", "X", { fuzzy: true })` is called
- **THEN** it SHALL return `"Xoo Xar"`

### Requirement: in-editor fuzzy highlight and navigation

When a fuzzy query is active in the search panel, the plugin SHALL highlight
the matched characters in the editor, support Next/Prev navigation that moves
the selection across matches, and support "All" which selects every match as a
multi-range selection.

- Highlights and navigation SHALL be scoped per line, matching the
  `findSearchMatches` semantics.
- "All" SHALL require and enable multiple selections.
- Clearing the fuzzy query (or the panel) SHALL remove the highlights.

#### Scenario: Highlight marks render
- **WHEN** a fuzzy query `"fbb"` is set on document `"foo bar baz"`
- **THEN** the three matched characters (`f`, `b`, `b`) SHALL be decorated in
  the editor

#### Scenario: Multi-range select-all
- **WHEN** `"a"` is fuzzy-searched on `"one alpha\ntwo beta"` and "All" is run
- **THEN** the editor selection SHALL contain two ranges (one per line)

#### Scenario: Clearing removes highlights
- **WHEN** a fuzzy query is set then nulled
- **THEN** the highlight decorations SHALL be removed
