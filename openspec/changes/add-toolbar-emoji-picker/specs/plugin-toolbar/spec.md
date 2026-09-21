## ADDED Requirements

### Requirement: Toolbar Can Insert An Emoji At The Caret

`plugin-toolbar` SHALL expose an `insertEmoji(editor, emoji)` command that inserts the emoji at the current caret position, replacing the selection when there is one. Empty input SHALL be rejected without touching the document.

#### Scenario: Inserting at a collapsed caret
- **WHEN** the document is `hi ` with the caret at the end
- **AND** `insertEmoji` is called with an emoji
- **THEN** the document SHALL be `hi ` followed by that emoji
- **AND** the command SHALL return `true`

#### Scenario: Inserting replaces the selection
- **WHEN** the selection covers `hello`
- **AND** `insertEmoji` is called with an emoji
- **THEN** the document SHALL be exactly that emoji

#### Scenario: Empty input is rejected
- **WHEN** `insertEmoji` is called with an empty string
- **THEN** the document SHALL NOT change
- **AND** the command SHALL return `false`

### Requirement: The Emoji Set Is Curated And Dependency-Free

`plugin-toolbar` SHALL ship a fixed, category-grouped emoji set. It MUST NOT add a runtime dependency for emoji data.

#### Scenario: Categories are exported for hosts
- **WHEN** a host imports `EMOJI_CATEGORIES` from the package entry point
- **THEN** it SHALL receive a list of categories, each with an `id`, a `label`, and a non-empty list of emoji
- **AND** every category SHALL have a unique `id`

### Requirement: The Picker Renders One Grid Per Category

The toolbar SHALL offer an emoji picker that renders every category as a labelled grid of emoji entries. Every entry SHALL be reachable by keyboard and carry its emoji as an accessible name.

#### Scenario: Every category renders
- **WHEN** the picker is open
- **THEN** a grid SHALL be rendered for each entry in `EMOJI_CATEGORIES`
- **AND** the number of emoji entries SHALL equal the total across all categories
- **AND** each entry SHALL expose its emoji through `aria-label`

### Requirement: Clicking An Entry Inserts And Closes

Clicking an emoji entry SHALL insert that emoji at the caret and close the picker.

#### Scenario: Click inserts and dismisses
- **WHEN** the picker is open with the caret at the end of `hi `
- **AND** an emoji entry is clicked
- **THEN** the document SHALL be `hi ` followed by the clicked emoji
- **AND** the picker SHALL be removed from the document

### Requirement: The Picker Reuses The Toolbar Dropdown Contract

The picker SHALL be registered through the existing dropdown path: listed in `DROPDOWN_IDS`, opened by the button's click handler, mounted on `document.body` with `DROPDOWN_STYLES`, closed on an outside click, and torn down through the returned `destroy()` when the toolbar is destroyed.

#### Scenario: Outside click closes the picker
- **WHEN** the picker is open
- **AND** a mousedown lands outside both the picker and its button
- **THEN** the picker SHALL close

#### Scenario: Destroying the toolbar removes an open picker
- **WHEN** the picker is open
- **AND** the toolbar is destroyed
- **THEN** the picker element SHALL be removed from the document

### Requirement: Existing Toolbar Behaviour Is Unchanged

Adding the emoji button SHALL NOT alter the behaviour of existing toolbar buttons, their dropdowns, their tooltips, or their default ordering beyond the new button's own position.

#### Scenario: Existing buttons keep their geometry
- **WHEN** the toolbar renders with default groups
- **THEN** every pre-existing button SHALL still expose its own `aria-label`, tooltip, and action
- **AND** the emoji button SHALL be the only addition to the default button set from this change
