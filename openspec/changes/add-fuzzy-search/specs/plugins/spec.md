## ADDED Requirements

### Requirement: Fuzzy Matching Mode

`@floatboat/nexus-plugin-search` SHALL provide an opt-in fuzzy matching mode for Roadmap #17 ("Fuzzy search"). When `SearchOptions.fuzzy` is `true`, `findSearchMatches` SHALL find matches whose query characters appear in the document as a subsequence, SHALL rank those matches by score using a documented scoring model (base match points, word-start and camelCase bonuses, consecutive-match bonus, and gap penalty), and SHALL break score ties by document position. Each reported match SHALL be the highest-scoring subsequence match for its start position, and no two reported matches SHALL share a start position. Each fuzzy match SHALL expose the exact matched character ranges in an optional `segments` field. The matcher SHALL be deterministic: identical input SHALL produce identical output.

#### Scenario: Subsequence match
- **GIVEN** a document containing `"fuzzy search"`
- **WHEN** a host calls `findSearchMatches(doc, "fzs", { fuzzy: true })`
- **THEN** the result SHALL contain a match spanning from the matched `f` at position 0 to the matched `s` at position 6
- **AND** the match SHALL report segments covering the `f`, `z`, and `s` character positions

#### Scenario: Ranked output
- **GIVEN** a document containing two candidate matches where one starts at a word boundary and the other does not
- **WHEN** a host runs a fuzzy search whose query matches both candidates
- **THEN** the word-boundary match SHALL appear first regardless of document position
- **AND** the ordering SHALL be stable across repeated calls

#### Scenario: Case sensitivity is respected
- **GIVEN** a document containing `"Alpha"` and `"alpha"`
- **WHEN** a host calls `findSearchMatches(doc, "Alp", { fuzzy: true, caseSensitive: true })`
- **THEN** only the `"Alpha"` occurrence SHALL match
- **WHEN** a host calls `findSearchMatches(doc, "ALP", { fuzzy: true })`
- **THEN** both occurrences SHALL match

#### Scenario: Empty query yields no matches
- **WHEN** a host calls `findSearchMatches(doc, "", { fuzzy: true })`
- **THEN** the result SHALL be an empty list

#### Scenario: Query longer than the document yields no matches
- **WHEN** a host calls `findSearchMatches(doc, "abcdef", { fuzzy: true })` on a document of length 4
- **THEN** the result SHALL be an empty list

### Requirement: Fuzzy Option Precedence

When `SearchOptions.fuzzy` is `true`, fuzzy matching SHALL take precedence over `regexp` and `wholeWord`: the query SHALL be matched as literal characters (regular-expression metacharacters SHALL NOT be interpreted), and whole-word boundaries SHALL be ignored. `caseSensitive` SHALL continue to apply. When `fuzzy` is absent or `false`, existing literal, regexp, and whole-word behavior SHALL remain unchanged.

#### Scenario: Regex metacharacters are literal under fuzzy
- **GIVEN** a document containing `"a.b"`
- **WHEN** a host calls `findSearchMatches(doc, ".", { fuzzy: true, regexp: true })`
- **THEN** the search SHALL match the literal `.` character instead of treating the query as a regular expression
- **AND** the search SHALL NOT throw

#### Scenario: Whole-word is ignored under fuzzy
- **GIVEN** a document containing `"xalfay"`
- **WHEN** a host calls `findSearchMatches(doc, "alf", { fuzzy: true, wholeWord: true })`
- **THEN** the match SHALL be found even though it is not bounded by word boundaries

#### Scenario: Default behavior is unchanged
- **GIVEN** a host calls `findSearchMatches` without a `fuzzy` option
- **THEN** matching SHALL behave exactly as before fuzzy support was added

### Requirement: Fuzzy Replacement Semantics

`replaceAllMatches` with `SearchOptions.fuzzy` set to `true` SHALL replace, for each fuzzy match, the span from the first to the last matched character with the provided replacement string verbatim, leaving unmatched document content intact. Group-substitution syntax in the replacement string SHALL be treated as literal text in fuzzy mode.

#### Scenario: Replacement covers the first-to-last matched span
- **GIVEN** a document `"fuzzy"`
- **WHEN** a host calls `replaceAllMatches(doc, "fzy", "x", { fuzzy: true })`
- **THEN** the result SHALL be `"x"`

#### Scenario: Unmatched content is preserved
- **GIVEN** a document `"prefix fuzzytail suffix"`
- **WHEN** a host calls `replaceAllMatches(doc, "ft", "x", { fuzzy: true })`
- **THEN** the result SHALL be `"prefix x suffix"`

#### Scenario: Replacement is literal
- **GIVEN** a fuzzy match
- **WHEN** a host passes a replacement string containing `$&`
- **THEN** the output SHALL contain the literal characters `$&` rather than the matched text

#### Scenario: Overlapping matches resolve in document order
- **GIVEN** a document `"xaaaaa"`
- **WHEN** a host calls `replaceAllMatches(doc, "aa", "y", { fuzzy: true })`
- **THEN** the result SHALL be `"xyya"`
- **AND** no character SHALL be replaced more than once
