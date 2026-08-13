# Editor Core Spec

## ADDED Requirements

### Requirement: provide fuzzyMatch on @floatboat/nexus-core

`fuzzyMatch(query, text, options?)` SHALL match `query` as an **ordered
subsequence** of `text` (not a contiguous substring) and return the best
alignment as `{ matched, score, positions }`.

- `matched` is `true` only when every character of `query` is found in `text`
  in order.
- `positions` is the list of indices into `text` of the matched characters,
  ascending; empty when `matched` is `false`.
- `score` is a number meaningful only when `matched` is `true`; higher is a
  better alignment. The score SHALL reward word-boundary / separator-aligned
  matches, camelCase transitions, and consecutive runs, and SHALL penalize gaps
  between matched characters and leading unmatched characters.
- `options.caseSensitive` defaults to `false`. When `false`, matching is
  case-insensitive.
- An empty `query` or `text` SHALL return `{ matched: false, score: 0,
  positions: [] }`.
- The matcher SHALL be pure and dependency-free.

#### Scenario: Subsequence matches across gaps
- **WHEN** `fuzzyMatch("fb", "foo bar")` is called
- **THEN** `matched` SHALL be `true` AND `positions` SHALL equal `[0, 4]`

#### Scenario: Non-subsequence does not match
- **WHEN** `fuzzyMatch("xyz", "foo bar")` is called
- **THEN** `matched` SHALL be `false` AND `positions` SHALL equal `[]`

#### Scenario: Case sensitivity
- **WHEN** `fuzzyMatch("FB", "foo bar", { caseSensitive: true })` is called
- **THEN** `matched` SHALL be `false`
- **AND** `fuzzyMatch("FB", "Foo Bar", { caseSensitive: true })` SHALL be `true`

#### Scenario: Boundary alignment beats interior match
- **WHEN** `fuzzyMatch("it", "Insert Table")` is called
- **THEN** `positions` SHALL equal `[0, 7]` (preferring the word-initial `T`
  over the `t` inside "Insert")

#### Scenario: Optimal alignment is not greedy-leftmost
- **WHEN** `fuzzyMatch("bc", "abxc")` is called
- **THEN** `positions` SHALL equal `[1, 3]`

### Requirement: provide fuzzyFilter on @floatboat/nexus-core

`fuzzyFilter(items, query, getText, options?)` SHALL return the items whose
`getText(item)` contains `query` as a fuzzy subsequence, each paired with its
`score` and `positions`, sorted by **descending score**.

- An empty `query` SHALL return every item with a neutral `score` of `0`,
  preserving input order.
- Items with no subsequence match SHALL be omitted.

#### Scenario: Ranking prefers tighter matches
- **WHEN** `fuzzyFilter(["foobar", "fobar", "fbr"], "fbr", s => s)` is called
- **THEN** the returned order SHALL be `["fbr", "fobar", "foobar"]`

#### Scenario: Empty query returns all items
- **WHEN** `fuzzyFilter(["alpha", "beta"], "", s => s)` is called
- **THEN** the result SHALL contain both items in input order
