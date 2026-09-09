## ADDED Requirements

### Requirement: Wiki Link Heading And Block Anchors

The wiki-link scanner SHALL parse Obsidian heading (`#`) and block (`^`) suffixes from `[[target]]` text and expose them as structured fields. Same-file jumps (`[[#heading]]`, `[[^block-id]]`) SHALL be valid links.

#### Scenario: File plus heading
- **WHEN** a document contains `[[MyNote#Setup]]`
- **THEN** `scanWikiLinks` SHALL report `target` `MyNote#Setup`, `path` `MyNote`, and `anchor` `{ kind: "heading", value: "Setup" }`

#### Scenario: Nested heading path
- **WHEN** a document contains `[[Guide#Parent#Child]]`
- **THEN** `path` SHALL be `Guide`
- **AND** `anchor.value` SHALL be `Parent#Child`

#### Scenario: Same-file heading
- **WHEN** a document contains `[[#Local heading]]`
- **THEN** `path` SHALL be empty
- **AND** `anchor` SHALL be `{ kind: "heading", value: "Local heading" }`
- **AND** the collapsed visible text SHALL be `Local heading` (the `#` marker is hidden with the brackets)

#### Scenario: Block reference
- **WHEN** a document contains `[[Spec^blk-1]]`
- **THEN** `path` SHALL be `Spec`
- **AND** `anchor` SHALL be `{ kind: "block", value: "blk-1" }`

#### Scenario: Same-file block
- **WHEN** a document contains `[[^quote-1]]`
- **THEN** `path` SHALL be empty
- **AND** `anchor` SHALL be `{ kind: "block", value: "quote-1" }`
- **AND** the collapsed visible text SHALL be `quote-1` (the `^` marker is hidden with the brackets)

#### Scenario: Block wiki link is not a footnote
- **WHEN** a document contains `[[^quote-1]]` and GFM footnotes are enabled
- **THEN** the token SHALL be a wiki link, not a `[^quote-1]` footnote superscript

### Requirement: Same-File Anchors Are Resolved

A wiki link whose path is empty and whose anchor is non-empty SHALL NOT be marked unresolved, even when the host `resolve` callback returns null.

#### Scenario: Current-file heading is not dashed-unresolved
- **WHEN** the document contains `[[#Local]]` and `resolve` returns null for every name
- **THEN** the chip SHALL NOT expose `data-wikilink-unresolved`
- **AND** clicking it SHALL call `onNavigate("#Local", { unresolved: false, path: "", anchor: { kind: "heading", value: "Local" } })`

#### Scenario: Current-file block is not dashed-unresolved
- **WHEN** the document contains `[[^quote-1]]` and `resolve` returns null for every name
- **THEN** the chip SHALL NOT expose `data-wikilink-unresolved`

### Requirement: Anchor Autocomplete

When `suggestAnchors` is provided, typing `[[` followed by a `#` or `^` SHALL query that callback for heading or block-id candidates and insert the selected value after the marker.

#### Scenario: Heading query after a note name
- **WHEN** the user has typed `[[Guide#Su` and `suggestAnchors` is configured
- **THEN** the host SHALL be called with `{ path: "Guide", kind: "heading", query: "Su" }`
- **AND** accepting `Summary` SHALL produce `[[Guide#Summary]]`

#### Scenario: Same-file heading query
- **WHEN** the user has typed `[[#Lo`
- **THEN** `suggestAnchors` SHALL be called with an empty `path` and `kind: "heading"`

#### Scenario: Same-file heading query at the marker
- **WHEN** the user has typed `[[#` with no heading text yet
- **THEN** `suggestAnchors` SHALL be called with `{ path: "", kind: "heading", query: "" }`
- **AND** an active note-name completion SHALL be discarded so heading candidates can open

#### Scenario: Note completion unchanged without a marker
- **WHEN** the user has typed `[[Gui` with no `#` or `^`
- **THEN** `suggest(query)` SHALL run as before
- **AND** `suggestAnchors` SHALL NOT be called

#### Scenario: Same-file block query at the marker
- **WHEN** the user has typed `[[^` with no block id yet
- **THEN** `suggestAnchors` SHALL be called with `{ path: "", kind: "block", query: "" }`

### Requirement: Missing Anchors Do Not Create Notes

`findAnchorPosition` SHALL return null when no heading or block id matches. Hosts SHALL NOT treat a missing in-note anchor as an unresolved wiki link that creates a file. Same-file jumps leave the caret unmoved; cross-file jumps still open the note and leave the caret at the document start (or wherever the host opened it).

#### Scenario: Unknown heading in the current file
- **WHEN** the user clicks `[[#Missing]]` and the current buffer has no heading whose text matches `Missing`
- **THEN** `findAnchorPosition` SHALL return null
- **AND** the host SHALL NOT create a new note

#### Scenario: Unknown heading after opening a note
- **WHEN** the user clicks `[[Daily/2026-04-20#Missing]]` and that note exists
- **THEN** the host SHALL open the note
- **AND** SHALL NOT move the caret to a heading
