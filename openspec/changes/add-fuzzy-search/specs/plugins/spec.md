## ADDED Requirements

### Requirement: Fuzzy Search Option

`@floatboat/nexus-plugin-search` SHALL provide opt-in fuzzy matching through `findSearchMatches()` without changing the default exact search behavior.

#### Scenario: Default exact search is unchanged
- **WHEN** a host calls `findSearchMatches(doc, query)` without `fuzzy: true`
- **THEN** the helper SHALL return exact matches using the existing case-sensitive, regexp, and whole-word options

#### Scenario: Fuzzy search matches subsequences
- **WHEN** a host calls `findSearchMatches(doc, query, { fuzzy: true })`
- **THEN** the helper SHALL treat the query as a literal subsequence
- **AND** it SHALL return matching spans that contain the matched subsequence

### Requirement: Fuzzy Match Metadata

Fuzzy search results SHALL include score and range metadata so host UIs can rank and highlight fuzzy hits without reparsing the text.

#### Scenario: Fuzzy match exposes score
- **WHEN** fuzzy search returns a match
- **THEN** the match SHALL include a numeric `score`

#### Scenario: Fuzzy match exposes ranges
- **WHEN** fuzzy search returns a non-contiguous match
- **THEN** the match SHALL include `ranges` for the contiguous matched character groups

### Requirement: Fuzzy Result Ordering and Limits

Fuzzy search SHALL support document-order results by default, score-first ordering when requested, and result capping after ordering.

#### Scenario: Document order remains default
- **WHEN** a host enables fuzzy search without `sortBy`
- **THEN** matches SHALL be returned by their document position

#### Scenario: Score ordering ranks better matches first
- **WHEN** a host enables fuzzy search with `sortBy: "score"`
- **THEN** matches with higher fuzzy scores SHALL be returned before lower-scored matches

#### Scenario: Max matches caps ordered results
- **WHEN** a host provides `maxMatches`
- **THEN** the helper SHALL return no more than that many matches after applying the requested ordering

### Requirement: Fuzzy Replacement

`replaceAllMatches()` SHALL support fuzzy replacement by replacing each fuzzy match span literally while preserving regex capture replacement behavior for non-fuzzy regex search.

#### Scenario: Fuzzy replacement replaces spans
- **WHEN** a host calls `replaceAllMatches(doc, query, replacement, { fuzzy: true })`
- **THEN** each fuzzy match span SHALL be replaced with the replacement text

#### Scenario: Regex captures stay scoped to regex search
- **WHEN** a host calls `replaceAllMatches()` with `regexp: true` and without `fuzzy: true`
- **THEN** existing regex capture-group replacement behavior SHALL remain unchanged

### Requirement: Demo Fuzzy Toggle

The Electron demo search bar SHALL expose fuzzy matching as an opt-in toggle that demonstrates the helper without changing default demo search behavior.

#### Scenario: Demo search remains exact by default
- **WHEN** the Electron demo search bar opens
- **THEN** fuzzy matching SHALL be disabled by default

#### Scenario: Demo search can enable fuzzy matching
- **WHEN** the user enables the fuzzy toggle and enters a query
- **THEN** the demo search bar SHALL call the search helpers with `fuzzy: true`
