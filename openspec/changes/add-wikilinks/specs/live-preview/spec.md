# Live Preview Spec — Wiki Link Additions

## ADDED Requirements

### Requirement: Wiki Link Inline Rendering

The live-preview extension SHALL recognize `[[target]]` and `[[target|alias]]` inline syntax and render each occurrence as a cursor-aware mark decoration whose visible text is the alias (when provided) or the target.

#### Scenario: Plain wiki link hides brackets when cursor is off the line
- **WHEN** a document contains `See [[MyNote]] for details.` and the cursor is on a different line
- **THEN** the substring `[[` and `]]` SHALL be hidden via zero-width replace decorations
- **AND** the visible text `MyNote` SHALL carry a wiki-link mark with pointer cursor and accent color
- **AND** the mark SHALL expose `data-wikilink-target="MyNote"` for click handling

#### Scenario: Aliased wiki link shows only the alias when cursor is off
- **WHEN** a document contains `[[MyNote|my note]]` and the cursor is elsewhere
- **THEN** the leading `[[MyNote|` and trailing `]]` SHALL be hidden
- **AND** the visible text SHALL be `my note`
- **AND** the target SHALL still be exposed as `data-wikilink-target="MyNote"`

#### Scenario: Cursor strictly inside the wikilink span reveals the raw markers
- **WHEN** the cursor is strictly inside the wikilink span (between its first and last character)
- **THEN** the `[[` / `]]` markers SHALL NOT be replaced
- **AND** the wikilink target text SHALL still receive the mark styling so the user can continue typing inside the brackets

#### Scenario: Cursor elsewhere on the same line keeps the link rendered
- **WHEN** the cursor is on the same line as a wikilink but NOT strictly inside its span
- **THEN** the `[[` / `]]` markers SHALL be hidden and only the display text remains visible

#### Scenario: Escape sequence is not matched
- **WHEN** a document contains `\[[NotALink]]`
- **THEN** no wikilink decoration SHALL be applied
- **AND** the literal text SHALL render unchanged

### Requirement: Wiki Link Resolved Versus Unresolved Styling

The extension SHALL distinguish resolved from unresolved wiki links by querying a host-supplied `resolve(name, fromPath)` callback and applying differentiated mark styling.

#### Scenario: Resolved link is styled as an accent-colored pointer chip
- **WHEN** `resolve` returns a non-null path for `MyNote`
- **THEN** the wikilink mark SHALL use the accent color and `cursor: pointer`

#### Scenario: Unresolved link is styled as a muted dashed chip
- **WHEN** `resolve` returns `null` for `Ghost`
- **THEN** the wikilink mark SHALL use a muted color and a dashed underline
- **AND** the mark SHALL expose `data-wikilink-unresolved="true"`

#### Scenario: Resolve callback absent
- **WHEN** the extension is created without a `resolve` callback
- **THEN** every wikilink SHALL render with the resolved style (optimistic fallback, no unresolved state)

### Requirement: Wiki Link Click Navigation

When the user clicks a wiki-link decoration, the extension SHALL invoke the host-supplied `onNavigate(target, options)` callback exactly once per click with the raw target string and an `unresolved` flag.

#### Scenario: Click on a resolved link calls onNavigate with unresolved=false
- **WHEN** the user clicks a resolved wikilink for `MyNote`
- **THEN** `onNavigate("MyNote", { unresolved: false })` SHALL be called
- **AND** the editor SHALL NOT follow the click as a normal caret move

#### Scenario: Click on an unresolved link reports unresolved=true
- **WHEN** the user clicks a wikilink whose `resolve` returned null
- **THEN** `onNavigate("Ghost", { unresolved: true })` SHALL be called

#### Scenario: No onNavigate callback leaves default behavior
- **WHEN** the extension is created without an `onNavigate` callback
- **THEN** clicking a wikilink SHALL be a no-op and SHALL fall through to normal caret positioning

### Requirement: Wiki Link Autocomplete

The extension SHALL register a CodeMirror autocomplete source that triggers after the user types `[[` and calls the host-supplied `suggest(query)` callback to populate candidates.

#### Scenario: Typing `[[q` queries suggest with `q`
- **WHEN** the user types `[[q` at the end of the line
- **THEN** `suggest("q")` SHALL be invoked
- **AND** each returned string SHALL appear as a completion label

#### Scenario: Accepting a completion inserts target and closing brackets
- **WHEN** the user selects `MyNote` from the completion list while having typed `[[m`
- **THEN** the buffer text SHALL become `[[MyNote]]`
- **AND** the cursor SHALL be positioned after the closing `]]`

#### Scenario: Autocomplete is disabled without a suggest callback
- **WHEN** the extension is created without a `suggest` callback
- **THEN** typing `[[` SHALL NOT open a completion popup
