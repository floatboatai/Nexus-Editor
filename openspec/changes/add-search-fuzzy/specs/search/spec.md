## ADDED Requirements
### Requirement: Fuzzy Search
The search plugin SHALL support fuzzy matching when the `fuzzy` option is
enabled. In fuzzy mode, the user's query characters are matched in order
against candidate text with any gaps allowed, and the resulting match spans
are converted into a valid regular expression usable by CodeMirror's search
cursor.

#### Scenario: Fuzzy match finds results with gaps
- **WHEN** the document contains "hello world" and the user searches "hlo"
  with `fuzzy: true`
- **THEN** "hello" is matched because 'h', 'l', 'o' appear in order

#### Scenario: Fuzzy match fails on wrong order
- **WHEN** the document contains "hello" and the user searches "olh"
  with `fuzzy: true`
- **THEN** no match is returned because characters are out of order

#### Scenario: Fuzzy exact match scores highest
- **WHEN** the document contains "hello" and the user searches "hello"
  with `fuzzy: true`
- **THEN** "hello" is matched with the maximum possible score

#### Scenario: Fuzzy mutually exclusive with regexp and wholeWord
- **WHEN** `fuzzy: true` is set
- **THEN** the `regexp` and `wholeWord` options SHALL be ignored

#### Scenario: Fuzzy toggle in search panel UI
- **WHEN** the search panel is open
- **THEN** a "Fuzzy" checkbox SHALL be visible alongside Match Case, Regexp,
  and By Word toggles
- **AND** checking it SHALL switch the search to fuzzy mode

#### Scenario: Reset fuzzy state on panel close
- **WHEN** the search panel is closed and reopened
- **THEN** the fuzzy checkbox SHALL reset to its default (off)
