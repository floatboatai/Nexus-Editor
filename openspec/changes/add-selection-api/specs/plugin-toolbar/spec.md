# Plugin Toolbar Spec

## MODIFIED Requirements

### Requirement: toggleOrderedList and toggleUnorderedList operate on all lines in the selection range

`toggleOrderedList` and `toggleUnorderedList` SHALL read the full selection range (both `anchor` and `head`) and apply or remove markers on every line that overlaps `[min(anchor,head), max(anchor,head))`. The toggle decision SHALL follow mixed-state-on semantics: if **all** lines already carry the marker the markers SHALL be removed; if **any** line is unmarked the marker SHALL be added to every line.

Toggle state detection:
- Ordered list marker: `/^\d+\.\s/`
- Unordered list marker: `/^[-*+]\s/`
- Cross-marker replacement: toggling ordered on a line with an unordered marker (or vice versa) SHALL strip the existing marker and apply the new one in the same operation.

Column-0 boundary: when the selection ends exactly at column 0 of a line (i.e. `to` equals the start of that line), that line SHALL be excluded from the range.

Reversed selection: when `head < anchor` the range SHALL be normalized using `Math.min`/`Math.max` before line enumeration.

All line transformations SHALL be written back in **one atomic CM6 transaction** via `replaceRange` so that a single Ctrl+Z fully restores the pre-toggle state.

#### Scenario: Multi-line add — all lines unmarked
- **WHEN** selection spans two unmarked lines and `toggleUnorderedList` is called
- **THEN** both lines SHALL have `"- "` prepended
- **AND** the change SHALL be reversible with a single `undo()`

#### Scenario: Multi-line remove — all lines marked
- **WHEN** selection spans two lines that both have `"- "` markers and `toggleUnorderedList` is called
- **THEN** both markers SHALL be removed

#### Scenario: Mixed state toggles on
- **WHEN** selection spans two lines where one has a marker and one does not
- **THEN** `toggleUnorderedList` SHALL add a marker to the unmarked line (mixed → on)

#### Scenario: Reversed selection is normalized
- **WHEN** `head < anchor` and the range spans two lines
- **THEN** both lines SHALL be toggled as if the selection were forward

#### Scenario: Column-0 boundary excludes trailing line
- **WHEN** selection ends at the start of a line (column 0)
- **THEN** that trailing line SHALL NOT receive a marker

#### Scenario: Cross-marker replacement ordered → unordered
- **WHEN** lines have `"1. "` markers and `toggleUnorderedList` is called
- **THEN** the ordered markers SHALL be replaced with `"- "` markers

#### Scenario: Sequential numbering for ordered list
- **WHEN** `toggleOrderedList` is called on a multi-line selection
- **THEN** lines SHALL be numbered sequentially starting at `1.`

#### Scenario: Atomic undo for multi-line toggle
- **WHEN** `toggleOrderedList` or `toggleUnorderedList` is called on a multi-line selection
- **THEN** a single `undo()` SHALL fully restore the pre-toggle document
- **AND** a second `undo()` SHALL return `false` (exactly one history entry was created)
