# Plugins Spec Delta

## ADDED Requirements

### Requirement: support multi-line selection for all formatting toolbar buttons

All formatting toolbar buttons (bold, italic, underline, strikethrough, inline code, heading, blockquote, ordered list, unordered list, text color, highlight) SHALL correctly format text selected across multiple lines.

#### Scenario: Bold multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks bold
- **THEN** `**` markers SHALL be toggled on each selected line's content
- **AND** asymmetric star markers (e.g., `**text*`) SHALL be corrected to a consistent count

#### Scenario: Italic multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks italic
- **THEN** `*` markers SHALL be toggled on each selected line's content

#### Scenario: Underline multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks underline
- **THEN** `<u>`/`</u>` tags SHALL be toggled on each selected line
- **AND** list markers (`- `, `1. `) SHALL NOT be wrapped in `<u>` tags

#### Scenario: Strikethrough multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks strikethrough
- **THEN** `~~` markers SHALL be toggled on each selected line's content

#### Scenario: Inline code multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks inline code
- **THEN** `` ` `` markers SHALL be toggled on each selected line's content

#### Scenario: Heading multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks heading
- **THEN** `## ` prefix SHALL be toggled on each selected line

#### Scenario: Blockquote multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks blockquote
- **THEN** `> ` prefix SHALL be toggled on each selected line

#### Scenario: Ordered list multi-line selection
- **WHEN** user selects text spanning multiple lines and clicks ordered list
- **THEN** `1. ` prefix SHALL be toggled on each selected line

#### Scenario: Text color multi-line selection
- **WHEN** user selects text spanning multiple lines and applies a text color
- **THEN** `<span style="color:...">` tags SHALL be applied to each selected line's content
- **AND** list markers SHALL NOT be wrapped in color spans

#### Scenario: Highlight multi-line selection
- **WHEN** user selects text spanning multiple lines and applies highlight
- **THEN** `<mark>` tags SHALL be applied to each selected line's content
- **AND** list markers SHALL NOT be wrapped in `<mark>` tags

### Requirement: partial selection across lines

When a selection covers only part of a line (not the full line), the formatting SHALL be applied to the entire line content, excluding list markers.

#### Scenario: Partial selection of a multi-line range
- **WHEN** user selects from the middle of line 1 to the middle of line 3 and clicks bold
- **THEN** the full content of all three lines SHALL receive `**` toggling
- **AND** list markers on any of those lines SHALL NOT be affected

#### Scenario: Partial selection with strikethrough
- **WHEN** user selects from middle of a line containing `~~text~~` to middle of the next line and clicks strikethrough
- **THEN** `~~` SHALL be toggled correctly (unwrap the first line, wrap the second)
