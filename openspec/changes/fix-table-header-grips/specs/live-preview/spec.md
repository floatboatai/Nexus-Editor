# Live Preview Spec - Header-Owned Table Grips

## MODIFIED Requirements

### Requirement: Editable table column interaction

The live-preview table widget SHALL render each column-selection and column-reorder grip inside the corresponding header cell, while preserving the existing table editing and selection behaviors.

#### Scenario: Column grips follow their header columns

- **WHEN** a Markdown table is rendered with live preview enabled
- **THEN** every data column header SHALL contain exactly one column grip
- **AND** the table SHALL NOT contain a standalone row used only for column grips

#### Scenario: Selecting a column from its header-owned grip

- **WHEN** a user clicks a column grip without moving the pointer
- **THEN** the corresponding header and body cells SHALL become the active column selection
- **AND** no cell SHALL enter text-editing mode

#### Scenario: Reordering a column from its header-owned grip

- **WHEN** a user drags a column grip over another column and releases it
- **THEN** the Markdown columns SHALL be reordered once
- **AND** the widget SHALL rebuild in the new order after its drag editing lock is released

#### Scenario: Existing table interactions remain available

- **WHEN** a user edits a cell, selects a cell range, clicks outside the table, or deletes a selected column or row
- **THEN** the existing behavior SHALL remain available after the grip placement change
