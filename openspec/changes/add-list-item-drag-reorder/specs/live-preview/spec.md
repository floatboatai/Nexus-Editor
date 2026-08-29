## ADDED Requirements

### Requirement: List item drag reorder

When live preview is enabled, list items SHALL expose grip handles that reorder sibling items in the Markdown source via custom pointer drag (not the HTML5 Drag API). Nested children SHALL move with their parent item and keep their indentation. Ordered lists SHALL renumber top-level markers after a move.

#### Scenario: Drag list item below a sibling
- **WHEN** the user drags a list item grip downward and drops on the lower half of another sibling
- **THEN** the dragged item's full source block (including nested children) SHALL move below that sibling in the document

#### Scenario: Drag preserves indentation
- **WHEN** a nested list item is dragged among its siblings
- **THEN** its indentation level and nested structure SHALL be preserved after the move

#### Scenario: Ordered list renumbers
- **WHEN** the user reorders items in an ordered list
- **THEN** the visible top-level markers SHALL renumber sequentially from the list start value

#### Scenario: Drag does not use HTML5 Drag API
- **WHEN** the user reorders via the grip
- **THEN** the interaction SHALL use mousedown / mousemove / mouseup handlers
- **AND** SHALL NOT rely on HTML5 drag-and-drop events
