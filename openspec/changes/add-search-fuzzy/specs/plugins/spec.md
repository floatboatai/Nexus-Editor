## ADDED Requirements

### Requirement: Fuzzy Matching Scope

`@floatboat/nexus-plugin-search` SHALL support an opt-in fuzzy mode that matches a query as an ordered subsequence of a single line. A match SHALL span from its first to its last matched character, and matches SHALL NOT cross a newline.

#### Scenario: Subsequence match across gaps
- **WHEN** fuzzy mode is enabled and the query is `fbb` in the document `foo bar baz`
- **THEN** the result SHALL contain the span from the leading `f` through the second `b`
- **AND** the span SHALL include the unmatched characters between the matches

#### Scenario: No match across a newline
- **GIVEN** the document contains `foo\nbar`
- **WHEN** fuzzy mode is enabled with the query `fb`
- **THEN** no match SHALL be returned

#### Scenario: Query longer than a line
- **GIVEN** a document whose longest line is shorter than the query
- **WHEN** fuzzy mode is enabled
- **THEN** no match SHALL be returned for that line

### Requirement: Fuzzy Scoring

Each fuzzy match SHALL carry a numeric score computed from per-character match points, word-boundary and camelCase bonuses, a consecutive-character bonus, an exact-case bonus under case-insensitive matching, and a penalty that grows with the length of unmatched gaps.

#### Scenario: Boundary start scores higher than mid-word start
- **GIVEN** two equally shaped matches where one starts at the beginning of a word and the other starts in the middle of a word
- **WHEN** fuzzy mode is enabled
- **THEN** the boundary match SHALL score higher

#### Scenario: Consecutive characters score higher than gapped ones
- **GIVEN** two matches of the same query where one aligns to adjacent characters and the other spans a longer gap
- **WHEN** fuzzy mode is enabled
- **THEN** the adjacent match SHALL score higher

#### Scenario: Exact case scores higher than case-folded case
- **GIVEN** case-insensitive fuzzy mode enabled
- **AND** two matches of the same span where one preserves the query casing and the other does not
- **WHEN** the matches are scored
- **THEN** the exact-case match SHALL score higher

#### Scenario: Case-sensitive mode requires exact casing
- **GIVEN** fuzzy mode enabled with case sensitivity enabled
- **WHEN** the document contains `Foo` and the query is `foo`
- **THEN** no match SHALL be returned

### Requirement: Fuzzy Mode Is Find-Only

Fuzzy mode SHALL NOT participate in replacement. Enabling fuzzy mode SHALL hide the replace toggle and replace row, and fuzzy replacement SHALL NOT be performed.

#### Scenario: Replace UI is hidden while fuzzy mode is active
- **WHEN** the user enables fuzzy mode in the search panel
- **THEN** the replace toggle SHALL be hidden
- **AND** the replace row SHALL NOT be expandable

#### Scenario: Replace control is restored after fuzzy mode
- **GIVEN** fuzzy mode is enabled in the search panel
- **WHEN** the user disables fuzzy mode
- **THEN** the replace toggle SHALL be visible again

#### Scenario: Fuzzy replacement is not destructive
- **GIVEN** fuzzy mode is enabled
- **WHEN** a replacement operation runs for that query
- **THEN** the matched text SHALL be written back unchanged

### Requirement: Fuzzy and Regexp Are Mutually Exclusive

Fuzzy mode SHALL be mutually exclusive with the regexp and whole-word options in the search panel. Enabling one SHALL clear the others.

#### Scenario: Fuzzy clears regexp and whole-word
- **GIVEN** regexp and whole-word are enabled in the search panel
- **WHEN** the user enables fuzzy mode
- **THEN** regexp and whole-word SHALL be cleared

#### Scenario: Regexp clears fuzzy
- **GIVEN** fuzzy mode is enabled in the search panel
- **WHEN** the user enables regexp
- **THEN** fuzzy mode SHALL be cleared

### Requirement: Existing Search Paths Are Unchanged

Fuzzy mode SHALL be opt-in. When fuzzy mode is disabled, literal, whole-word, and regexp matching SHALL return matches in document order with the same result shape and no score field.

#### Scenario: Literal search keeps its result shape
- **WHEN** fuzzy mode is not enabled and a literal query is searched
- **THEN** each result SHALL contain only its range and matched text

#### Scenario: Fuzzy results stay in document order
- **WHEN** fuzzy mode is enabled with multiple matches in the document
- **THEN** the results SHALL be ordered by document position rather than by score

#### Scenario: Empty query returns no results
- **WHEN** fuzzy mode is enabled with an empty query
- **THEN** no match SHALL be returned

### Requirement: Fuzzy Mode Drives the CodeMirror Search Pipeline

Fuzzy mode SHALL drive the editor's existing navigation, selection, and highlighting behavior so that `findNext`, `findPrevious`, select-all, viewport match highlighting, and rendered table-cell search highlights follow fuzzy matches.

#### Scenario: Next and previous navigate fuzzy matches
- **GIVEN** fuzzy mode is enabled with multiple matches in the document
- **WHEN** the user presses Enter in the search input and presses the next control again
- **THEN** the selection SHALL move from the first fuzzy match to the second in document order

#### Scenario: Select-all selects fuzzy matches
- **GIVEN** fuzzy mode is enabled with multiple matches in the document
- **WHEN** the user runs select-all for the current query
- **THEN** the editor selection SHALL contain one range per fuzzy match

#### Scenario: Table cell highlights follow fuzzy matches
- **GIVEN** a rendered table cell whose source text contains the fuzzy match
- **WHEN** fuzzy mode is enabled and the query is submitted
- **THEN** the rendered cell SHALL be highlighted at the mapped source range

### Requirement: Fuzzy Toggle Label Is Localizable

The fuzzy toggle label SHALL resolve through the existing search label options with a built-in default.

#### Scenario: Default fuzzy label
- **WHEN** the search panel is created without label overrides
- **THEN** the fuzzy toggle SHALL be labeled `Fuzzy`

#### Scenario: Localized fuzzy label
- **GIVEN** the host passes a label for the fuzzy toggle
- **WHEN** the search panel is opened
- **THEN** the fuzzy toggle SHALL use the host-provided label

### Requirement: No New Runtime Dependency

Fuzzy matching SHALL be implemented in-package without adding a runtime dependency and without declaring `@codemirror/state` as a direct dependency of `@floatboat/nexus-plugin-search`.

#### Scenario: Dependency set is unchanged
- **WHEN** this change is applied
- **THEN** `packages/plugin-search/package.json` SHALL keep the same dependency list
