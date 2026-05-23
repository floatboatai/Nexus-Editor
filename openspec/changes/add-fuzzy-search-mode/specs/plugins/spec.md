# Plugins Spec - Fuzzy Search Mode

## ADDED Requirements

### Requirement: provide fuzzy search helpers

The `@floatboat/nexus-plugin-search` package SHALL provide dependency-free
fuzzy search helpers that treat a query as an ordered subsequence of characters.
The helpers SHALL return match ranges in document offsets, the exact matched
character indices, and score metadata that rewards compact, boundary-aligned,
and contiguous matches.

#### Scenario: Ordered subsequence match
- **WHEN** a host calls `findFuzzySearchMatches("Nexus Editor", "nxe")`
- **THEN** the result SHALL include a match covering `Nexus E`
- **AND** the match SHALL expose the document indices that satisfied `n`, `x`, and `e`
- **AND** the match SHALL expose a numeric `score`

#### Scenario: Case-sensitive fuzzy match
- **WHEN** a host calls `findFuzzySearchMatches(doc, query, { caseSensitive: true })`
- **THEN** only characters with matching case SHALL satisfy the fuzzy query

#### Scenario: Common helper opt-in
- **WHEN** a host calls `findSearchMatches(doc, query, { fuzzy: true })`
- **THEN** the helper SHALL return fuzzy matches
- **AND** omitting `fuzzy` SHALL retain the existing literal search behaviour

### Requirement: provide fuzzy search panel mode

The `@floatboat/nexus-plugin-search` panel SHALL provide an opt-in fuzzy mode.
When enabled, the panel SHALL compile the raw user query to a safe line-local
regular expression for CodeMirror navigation while continuing to display the
raw query text in the input.

#### Scenario: Plugin-level fuzzy default
- **WHEN** a host enables `createSearchPlugin({ fuzzy: true })`
- **AND** the search panel opens
- **THEN** the `Fuzzy` checkbox SHALL be checked by default
- **AND** the user SHALL be able to type a compact query such as `nxe`

#### Scenario: Raw input is preserved
- **WHEN** fuzzy mode is active
- **AND** the user types `nxe`
- **THEN** the input field SHALL continue to display `nxe`
- **AND** CodeMirror SHALL receive a generated line-local regexp query that can match `Nexus Editor`

#### Scenario: Incompatible toggles are disabled
- **WHEN** fuzzy mode is active
- **THEN** the `Regexp` and `By word` toggles SHALL be disabled
- **AND** the `Match case` toggle SHALL remain available

#### Scenario: Generated pattern is escaped and line-local
- **WHEN** the query contains regexp syntax characters such as `.`
- **THEN** `createFuzzySearchPattern` SHALL escape those characters
- **AND** the generated gaps SHALL NOT match newline characters
