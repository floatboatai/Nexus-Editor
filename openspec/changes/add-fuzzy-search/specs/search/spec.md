## MODIFIED Requirements

### Requirement: Search Options and Query Matching
The system SHALL support configured search options including case sensitivity, whole word boundaries, regular expressions, search query history, and fuzzy subsequence matching.

#### Scenario: Fuzzy search matching
- **WHEN** the search option `fuzzy` is set to `true`
- **THEN** the search engine matches subsequences of characters within the target text, calculating scores based on contiguous matching characters, word boundaries, and position distance, highlighting matched ranges.

#### Scenario: Fuzzy search toggle in UI panel
- **WHEN** the search panel is opened
- **THEN** a fuzzy search checkbox control (`[data-test-id="search-fuzzy"]`) is rendered in the panel alongside case-sensitive, match-by-word, and regexp checkboxes.
