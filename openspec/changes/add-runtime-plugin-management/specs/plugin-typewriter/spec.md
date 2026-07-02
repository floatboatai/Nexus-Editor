# plugin-typewriter

## ADDED Requirements

### Requirement: Typewriter scrolling

The plugin SHALL keep the cursor line vertically centered in the editor scroller after document edits and cursor movement while installed.

#### Scenario: Centering after typing

- **WHEN** the user types at the cursor while the typewriter plugin is installed
- **THEN** the editor scrolls so the cursor line is positioned at the vertical center of the visible area

#### Scenario: Centering after cursor movement

- **WHEN** the user moves the cursor to another line (keyboard or click) while the plugin is installed
- **THEN** the editor scrolls the new cursor line toward the vertical center

### Requirement: Hot-pluggable by construction

The plugin factory SHALL return a `NexusPlugin` that declares only hot-pluggable hooks (`cmExtensions`), so it can be installed and removed at runtime with no residue.

#### Scenario: Runtime install/uninstall round-trip

- **WHEN** the plugin is added via `addPlugin` and later removed via `removePlugin`
- **THEN** centering behavior is active only between add and remove, and no scrolling side effects occur after removal
