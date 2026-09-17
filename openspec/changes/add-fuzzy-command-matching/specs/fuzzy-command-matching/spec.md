## ADDED Requirements

### Requirement: Fuzzy Subsequence Matching

`@floatboat/nexus-core` SHALL expose a dependency-free matcher that aligns every query character to a distinct target character, in order. The matcher MUST return `null` when the query is empty, when the target is empty, or when the query is not a subsequence of the target. Matching SHALL be case-insensitive by default and case-sensitive when `{ caseSensitive: true }` is passed. The result MUST report the matched positions as ascending UTF-16 code-unit offsets into the original target string, so callers can map them back onto the rendered text without re-deriving them.

#### Scenario: Non-contiguous subsequence matches
- **WHEN** `matchFuzzy("tbl", "Table")` is called
- **THEN** the matcher MUST return a result whose positions are `[0, 2, 3]`
- **AND** the result MUST preserve the original target casing in the reported positions

#### Scenario: Query is not a subsequence
- **WHEN** the query characters do not all appear in the target in order
- **THEN** the matcher MUST return `null`

#### Scenario: Case handling
- **WHEN** the matcher runs with default options against the target `Table` and the query `tbl`
- **THEN** it MUST match
- **AND** the same query with `{ caseSensitive: true }` MUST NOT match

#### Scenario: Astral characters are matched whole
- **WHEN** the target contains astral characters such as emoji
- **THEN** each astral character MUST count as a single query character
- **AND** the reported positions MUST be contiguous code-unit offsets such that slicing the target at those offsets reconstructs the matched character

#### Scenario: CJK targets match
- **WHEN** the query contains CJK characters that appear in order in the target
- **THEN** the matcher MUST return their positions

### Requirement: Alignment Quality Scoring

The matcher SHALL score a valid alignment from a match base plus positional bonuses minus gap penalties, such that: a match at the beginning of the target scores higher than the same match later in the target; a match at a word start, after a separator, or at a camelCase hump scores higher than the same match in the middle of a word; an adjacent match scores higher than the same match separated by skipped characters; and a gapped alignment is penalised more the more characters it skips. The weights are implementation-defined, but the ordering they produce MUST be deterministic for identical inputs.

#### Scenario: Contiguous alignment beats scattered alignment
- **WHEN** the query `ab` can align either contiguously or by skipping characters in the same target
- **THEN** the matcher MUST choose the contiguous alignment

#### Scenario: Word start beats mid-word
- **WHEN** the query `tb` can align at a word start (`Table`) or across a word boundary inside another target
- **THEN** the alignment that starts a word MUST score higher

#### Scenario: camelCase hump is recognised
- **WHEN** the query `gc` is matched against `getContent`
- **THEN** the matcher MUST return the positions of `g` and `C`

#### Scenario: Deterministic scoring
- **WHEN** the same query and target are matched repeatedly
- **THEN** the score and positions MUST be identical on every call

#### Scenario: Long targets stay bounded
- **WHEN** the target is longer than the optimal-alignment limit
- **THEN** the matcher MUST still return a valid alignment for a matching query
- **AND** its positions MUST remain ascending and within the target

### Requirement: Slash Command Fuzzy Fallback

Slash command ranking SHALL keep its existing literal tiers (exact title, title prefix, exact keyword, title substring, keyword prefix, keyword substring) and their tiebreakers unchanged, and SHALL additionally consider fuzzy subsequence matches as the lowest tier. A query that matches no command literally SHALL therefore still return the commands whose title or keywords contain the query characters in order.

#### Scenario: Fuzzy-only query returns commands
- **WHEN** the user types `/tbl`
- **AND** a registered command has the title `Table`
- **THEN** the command MUST be returned even though `tbl` is not a contiguous substring of `Table`

#### Scenario: Literal matches keep precedence
- **WHEN** one command matches through a literal tier and another only through the fuzzy tier
- **THEN** the literal match MUST rank higher regardless of the fuzzy alignment score

#### Scenario: Existing ordering is preserved
- **WHEN** every candidate in a list matches at a literal tier
- **THEN** the returned order MUST be identical to the ordering produced before fuzzy matching existed

#### Scenario: Non-subsequence queries stay empty
- **WHEN** the query characters do not appear in any command title or keyword in order
- **THEN** the ranking MUST return an empty list

### Requirement: Slash Command Match Positions

`rankSlashCommands(commands, query)` SHALL report, for every returned command, the winning score, the field that produced it (`title` or `keyword`), the text of that field, and the ascending positions within that text covered by the query. `filterSlashCommands` SHALL return the same ordering as `rankSlashCommands` and remain a projection of it.

#### Scenario: Title positions are reported
- **WHEN** `/ta` ranks the command `Table` through the title-prefix tier
- **THEN** the ranking MUST report field `title`, matched text `Table`, and positions `[0, 1]`

#### Scenario: Keyword positions are reported
- **WHEN** a command is returned because one of its keywords matched
- **THEN** the ranking MUST report field `keyword` and positions relative to that keyword text

#### Scenario: Empty query preserves registration order
- **WHEN** the query is empty
- **THEN** the ranking MUST preserve registration order
- **AND** every entry MUST report empty positions

### Requirement: Slash Menu Highlights Matched Characters

`createSlashMenuUI` SHALL wrap the title characters covered by the current query in `mark` elements carrying the class `{classPrefix}-menu__match`, MUST leave the title text content unchanged, and MUST remove marks that no longer apply when the query changes.

#### Scenario: Fuzzy query highlights the title
- **WHEN** the user types `/tbl` and the `Table` command is rendered
- **THEN** the title element MUST contain marks covering `T` and `bl`
- **AND** the title element's text content MUST still equal `Table`

#### Scenario: Keyword-only match renders plain text
- **WHEN** a command is returned because only one of its keywords matched
- **THEN** the title MUST render without any mark elements

#### Scenario: Query change clears stale marks
- **WHEN** the user changes the slash query so that previously highlighted characters no longer match
- **THEN** the previously rendered mark elements MUST be removed from the title element
