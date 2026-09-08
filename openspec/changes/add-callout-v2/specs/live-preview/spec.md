# Live Preview Spec Delta

## ADDED Requirements

### Requirement: fenced callouts support multi-paragraph markdown bodies

A `:::type [title]` fenced callout whose body contains blank lines SHALL render as a single callout block, with the body parsed as full markdown (same dialect as the host document: GFM tables, task lists, footnotes, inline marks, code blocks, lists).

#### Scenario: Multi-paragraph body renders inside one callout
- **WHEN** document contains `:::info Title\nFirst paragraph.\n\nSecond paragraph.\n:::`
- **THEN** a single callout block SHALL render containing both paragraphs
- **AND** no raw `:::` fence source SHALL be visible in the preview

#### Scenario: Inline markdown inside a callout body
- **WHEN** a callout body contains `**bold**`, `` `code` ``, or `[text](url)`
- **THEN** the body SHALL render them as strong emphasis, inline code, and a link respectively

#### Scenario: Block markdown inside a callout body
- **WHEN** a callout body contains a list and/or a fenced code block
- **THEN** the list and code block SHALL render inside the callout body with the same styling as top-level content

### Requirement: fenced callouts support nesting

A fenced callout containing another fenced callout in its body SHALL close on its own closing fence, not the inner one; the inner callout SHALL render nested inside the outer callout's body.

#### Scenario: Nested callouts render inside out
- **WHEN** document contains `:::warning Outer\n\ntext\n\n:::info Inner\nbody\n:::\n:::`
- **THEN** two callout blocks SHALL render, the inner one nested inside the outer one's body
- **AND** no raw `:::` fence source SHALL be visible

### Requirement: `:::` inside fenced code does not close an open callout

A `:::` line inside a fenced code block (or indented code block / raw HTML block) that sits inside a callout body SHALL be treated as code content and SHALL NOT close the enclosing callout.

#### Scenario: Code sample containing a fence line
- **WHEN** a callout body contains a fenced code block whose content includes a bare `:::` line
- **THEN** the outer callout SHALL close on its real closing fence
- **AND** the code block SHALL display the `:::` line as code

### Requirement: unclosed fenced callouts fall back to plain text

A `:::type` fence with no matching closing fence SHALL NOT produce a callout block; the source SHALL render as ordinary paragraph text.

#### Scenario: Missing closing fence
- **WHEN** document contains `:::info\nno closing fence` with no terminating `:::`
- **THEN** no callout block SHALL render and the raw source SHALL remain visible

### Requirement: GFM alerts support custom titles

A GFM alert head line of the form `> [!TYPE] Custom Title` SHALL render the alert with the custom title as the badge label, and the raw tag/title source SHALL be replaced by the badge.

#### Scenario: Custom title on the badge
- **WHEN** document contains `> [!NOTE] Deploy checklist` followed by body lines
- **THEN** the alert badge SHALL display "Deploy checklist" instead of "Note"
- **AND** the raw `[!NOTE]` tag SHALL not be visible as duplicate text

### Requirement: GFM alerts support fold markers

A GFM alert head line MAY carry an Obsidian-style fold marker: `-` (collapsed by default) or `+` (expanded, collapsible). Foldable alerts SHALL render a chevron control on the badge; activating it toggles body visibility.

#### Scenario: `-` marker collapses by default
- **WHEN** document contains `> [!TIP]- Title` followed by body lines and the cursor is outside the blockquote
- **THEN** the alert body SHALL be hidden behind a fold placeholder
- **AND** the badge SHALL display a collapsed-state chevron
- **WHEN** the chevron is activated
- **THEN** the body SHALL become visible

#### Scenario: `+` marker expands by default
- **WHEN** document contains `> [!WARNING]+ Title` followed by body lines
- **THEN** the body SHALL be visible and the badge SHALL display an expanded-state chevron
- **WHEN** the chevron is activated
- **THEN** the body SHALL be hidden behind the fold placeholder

#### Scenario: Static alerts have no chevron
- **WHEN** document contains `> [!CAUTION]` with no fold marker
- **THEN** the badge SHALL render without a chevron and the body SHALL always be visible

#### Scenario: Editing suspends folding
- **WHEN** a foldable alert is collapsed and the cursor enters the blockquote
- **THEN** the full source SHALL become visible and editable regardless of fold state
