# Plugins Spec

## ADDED Requirements

### Requirement: provide an editor search plugin

The `@floatboat/nexus-plugin-search` package SHALL provide a functional CodeMirror-backed search panel with keyboard shortcuts, match navigation, replacement controls, and stable DOM selectors for host applications.

#### Scenario: Open search panel
- **WHEN** a host enables `createSearchPlugin()` and the user presses Mod+F
- **THEN** the editor SHALL open a search panel
- **AND** the panel SHALL expose stable `data-test-id` attributes for automation
- **AND** replacement controls SHALL be hidden until the user expands them with a replace toggle

#### Scenario: Toggle replacement controls
- **GIVEN** the search panel is open in a writable editor
- **WHEN** the user activates the replace toggle
- **THEN** the plugin SHALL show the replacement input and replace actions
- **AND** the toggle SHALL expose its expanded state with `aria-expanded`
- **WHEN** the user activates the replace toggle again
- **THEN** the plugin SHALL hide the replacement input and replace actions

#### Scenario: Navigate matches
- **GIVEN** the search panel is open with a non-empty query
- **WHEN** the user presses Enter in the search input or activates next/previous
- **THEN** the editor SHALL move to the corresponding match and highlight visible matches

### Requirement: provide a Mermaid diagram plugin

A `@floatboat/nexus-plugin-mermaid` package SHALL render `mermaid` code blocks as SVG diagrams when the cursor is outside, and show raw mermaid source when the cursor is inside.

#### Scenario: Render mermaid diagram
- **WHEN** document contains a fenced code block with language `mermaid`
- **AND** cursor is outside the block
- **THEN** the block SHALL be rendered as an SVG diagram via mermaid.js

#### Scenario: Edit mermaid source
- **WHEN** cursor enters a mermaid code block
- **THEN** the raw mermaid syntax SHALL be shown for editing
- **AND** syntax highlighting SHALL be applied

#### Scenario: Invalid mermaid syntax
- **WHEN** the mermaid source has syntax errors
- **THEN** an error message SHALL be displayed instead of the diagram

### Requirement: support list item drag reorder

List items SHALL have grip handles (similar to table rows) that allow drag-and-drop reordering.

#### Scenario: Drag list item down
- **WHEN** user drags a list item grip handle downward past another item
- **THEN** the dragged item SHALL move below the target item in the document

#### Scenario: Drag preserves indentation
- **WHEN** a nested list item is dragged
- **THEN** its indentation level SHALL be preserved after the move
