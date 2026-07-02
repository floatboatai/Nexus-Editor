## ADDED Requirements

### Requirement: Reference workspace layout
The Electron demo SHALL present file actions, vault navigation, the editor, outline navigation, and backlinks in a visually coherent desktop workspace based on the supplied reference.

#### Scenario: Initial workspace
- **WHEN** the Electron renderer starts
- **THEN** file actions appear in the leading area of the top bar
- **AND** panel, search, and settings controls appear in the trailing area
- **AND** the vault, editor, outline, and backlinks regions remain visually distinct

### Requirement: Panel toggle state
Panel toggle controls SHALL expose whether their associated panel is currently visible.

#### Scenario: Toggle a workspace panel
- **WHEN** the user activates a vault, outline, or backlinks toggle
- **THEN** the corresponding panel changes visibility
- **AND** the control's pressed state reflects the resulting visibility

### Requirement: Responsive workspace
The workspace SHALL preserve the editor as the primary surface when the available window width is constrained.

#### Scenario: Narrow window
- **WHEN** the application window becomes narrower than the full four-column layout
- **THEN** secondary panels use reduced widths or are hidden at defined breakpoints
- **AND** the editor remains usable
