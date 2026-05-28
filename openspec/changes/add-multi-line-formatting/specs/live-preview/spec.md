# Live Preview Spec Delta

## ADDED Requirements

### Requirement: render inline HTML tags in list items without line breaks

Inline HTML tags (`<span>`, `<u>`) that appear inside list items SHALL be rendered as inline elements (not block-level widgets), preserving the list structure without visual line breaks.

#### Scenario: Span with color in ordered list
- **WHEN** document contains `1. <span style='color:red'>text</span> more`
- **AND** cursor is outside the HTML range
- **THEN** the span SHALL render inline with red text
- **AND** NO `nexus-html-block` wrapper SHALL be present
- **AND** the list bullet `1.` SHALL still be visible

#### Scenario: Underline in unordered list
- **WHEN** document contains `- <u>under</u> line`
- **AND** cursor is outside the HTML range
- **THEN** the `<u>` tag SHALL render as underlined text inline
- **AND** the list bullet SHALL still be visible

#### Scenario: Cursor enters inline HTML in list item
- **WHEN** cursor moves into an inline HTML range inside a list item
- **THEN** the raw HTML source SHALL be shown for editing
- **AND** the list bullet SHALL remain visible

#### Scenario: Click rendered inline HTML to edit
- **WHEN** user clicks on a rendered inline HTML element in a list item
- **THEN** the cursor SHALL move to the start of the HTML source range
- **AND** the raw source SHALL be revealed for editing

### Requirement: prevent list markers from being selectable

List markers (`1. `, `- `, `* `) in live preview SHALL be rendered with `user-select: none` and SHALL NOT accept cursor placement or text selection.

#### Scenario: Bullet widget has user-select:none
- **WHEN** an unordered list is rendered in live preview
- **THEN** bullet span elements SHALL have `user-select: none`

#### Scenario: Cursor cannot land on list marker on click
- **WHEN** user clicks on a list marker position in live preview
- **THEN** the cursor SHALL be placed at the start of the content text (after the marker)
- **AND** the marker text SHALL NOT be editable

#### Scenario: Multi-line selection excludes list markers
- **WHEN** user drag-selects across multiple list items
- **THEN** the selection range SHALL exclude list marker positions
- **AND** marker text SHALL NOT appear in the selection
