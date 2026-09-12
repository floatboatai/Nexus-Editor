## ADDED Requirements

### Requirement: Optional selection toolbar with explicit actions

The `@floatboat/nexus-plugin-selection-toolbar` package SHALL export `createSelectionToolbarUI(editor, options)` with explicit `editorRoot` and `groups`, and optional `onAction` and `focusShortcut`. It SHALL return a handle exposing `element`, `ready`, `dismiss()`, `focus()`, and idempotent `destroy()`. The toolbar SHALL initially be hidden. It SHALL receive actions from its host and SHALL NOT import formatting implementations. The demo SHALL configure the existing link, inline-code, and text-color actions in that order, with text color opening a host-owned picker. Consumers SHALL be able to independently configure direct-action buttons and their order without changing or automatically mirroring the global toolbar. A supplied `onAction` SHALL replace direct button execution without invoking both paths.

#### Scenario: Consumer opts in

- **WHEN** a consumer creates a selection-toolbar instance for an editable editor
- **THEN** the instance SHALL support selection-driven display and expose idempotent cleanup
- **AND** consumers that do not create the instance SHALL retain their existing behavior

#### Scenario: Explicit button configuration

- **WHEN** a consumer supplies a custom action list
- **THEN** the floating toolbar SHALL use that list and order
- **AND** the global toolbar SHALL retain its own configuration
- **AND** an empty list SHALL produce no visible floating toolbar

### Requirement: Display only for eligible continuous body selections

The toolbar SHALL display for a completed desktop user selection containing non-whitespace body text in exactly one continuous range, in source and live-preview modes. It SHALL support forward, reversed, multiline, double-click and keyboard selection. It SHALL NOT display for multiple ranges, collapsed selections, read-only editors, IME composition, touch selection, or selections intersecting tables, block code or unsupported interactive widgets. Inline code SHALL remain eligible.

#### Scenario: User completes a body selection

- **WHEN** the user finishes selecting an eligible continuous body range
- **THEN** the toolbar SHALL appear near that selection without taking editor focus

#### Scenario: Selection is still being extended

- **WHEN** the user is dragging or holding a selection key to extend a body selection
- **THEN** the toolbar SHALL remain hidden until pointer release or selection-key release

#### Scenario: Multiple ranges or excluded surface

- **WHEN** an editor has multiple ranges or the selection belongs to or intersects an excluded surface
- **THEN** the floating toolbar SHALL be hidden
- **AND** it SHALL NOT execute actions on a stale main selection

#### Scenario: Programmatic selection update

- **WHEN** a document load or unrelated API call updates selection without a user selection gesture
- **THEN** the toolbar SHALL NOT automatically open

### Requirement: Actions preserve the toolbar session and share command semantics

Floating formatting actions SHALL execute the same formatting operation as the corresponding global action against the instance's actual source editor. Executing the demo-configured inline-code action SHALL keep the toolbar visible when the resulting selection remains eligible. The toolbar SHALL use the command's final selection rather than restore stale pre-command offsets.

#### Scenario: Apply and remove inline code

- **WHEN** the user selects plain body text and clicks inline code
- **THEN** the document and selection SHALL match the existing global inline-code operation
- **AND** the toolbar SHALL remain available for a second click to remove the formatting
- **AND** intermediate document and selection notifications SHALL NOT dismiss or flicker the toolbar

#### Scenario: Inline-code text remains selected

- **WHEN** the user selects `world` in `hello world` and activates inline code
- **THEN** the document SHALL become "hello `world`"
- **AND** `world` SHALL remain selected inside the markers
- **AND** activating inline code again SHALL restore `hello world` with `world` selected and the toolbar visible

#### Scenario: Source editor becomes invalid

- **WHEN** a command is pending and its document or editor context is replaced or disposed
- **THEN** the stale completion SHALL NOT reopen the toolbar or focus another editor
- **AND** command execution SHALL NOT silently fall back to a recent editor

### Requirement: Explicit dismissal persists until a new selection gesture

Outside interaction, collapsed or invalid selection, external focus loss, document switch, and Escape SHALL close the toolbar. Escape SHALL preserve the text selection. Geometry updates and repeated selection notifications SHALL NOT reopen an explicitly dismissed session. A new user selection gesture SHALL permit reopening, including when it selects the same character range.

#### Scenario: Escape followed by scrolling

- **WHEN** the user presses Escape while the toolbar is visible and then scrolls without reselecting
- **THEN** the selected text SHALL remain selected
- **AND** the toolbar SHALL remain closed

#### Scenario: Reselect text

- **WHEN** the user begins another selection after dismissal
- **THEN** the old toolbar SHALL remain hidden during selection
- **AND** the completed eligible selection SHALL open a new toolbar session

### Requirement: Position relative to the visible selection

For a single visual line, the toolbar SHALL center above the selection with an 8px gap. For multiple visual lines, it SHALL anchor near the selection head's visual line and prefer below when placement above would obscure selected text. It SHALL flip vertically and clamp horizontally within the visible editor/window intersection with an 8px edge margin. It SHALL remeasure after layout, scroll, and viewport changes without scrolling the document itself.

#### Scenario: Limited space near a window edge

- **WHEN** the preferred toolbar position would overflow the available area
- **THEN** the toolbar SHALL flip or shift to a visible position without covering selected text where space permits

#### Scenario: Selection anchor becomes unavailable

- **WHEN** the anchor is outside the visible editing area or its coordinates cannot be measured
- **THEN** the toolbar SHALL hide rather than retain stale screen coordinates
- **AND** becoming visible again SHALL NOT override an explicit dismissal

#### Scenario: Visible anchor returns after scrolling

- **WHEN** scrolling brings a measurable anchor back into view
- **THEN** a session hidden only by geometry SHALL become visible again
- **AND** an explicitly dismissed session SHALL remain closed

### Requirement: Isolated lifecycle

Each floating toolbar SHALL belong to one editor instance and its owner Document. It SHALL clean up DOM, event listeners, pending measurements and extension registrations when destroyed or unloaded. Legacy and runtime integrations SHALL have exactly one owner.

#### Scenario: Two editors and plugin unload

- **WHEN** two editors have toolbar instances and one is detached or its plugin is unloaded
- **THEN** the affected UI SHALL stop responding and be removed
- **AND** the other editor SHALL retain its document, selection and toolbar behavior
- **AND** repeated cleanup SHALL be harmless

### Requirement: Keyboard interaction and accessibility

The root SHALL expose `role="toolbar"` and an accessible name. Buttons SHALL have accessible names and visible keyboard focus. Auto-display SHALL preserve editor focus. Once deliberately focused, ArrowLeft/ArrowRight SHALL navigate buttons, Enter/Space SHALL activate, and Escape SHALL dismiss and restore the source editor focus. The optional `focusShortcut` SHALL bind Alt+F10 only while visible and SHALL default to disabled. Body arrow keys and Tab SHALL remain available to the editor. Hidden toolbars SHALL NOT consume keys.

#### Scenario: Keyboard operation

- **WHEN** the user deliberately focuses the visible toolbar
- **THEN** its actions SHALL be keyboard reachable and activatable
- **AND** focus inside the toolbar SHALL NOT cause it to close as an external blur
- **AND** Escape SHALL close it and return focus to its valid source editor

#### Scenario: Hidden toolbar passes keys through

- **WHEN** the toolbar is hidden and the editor receives Escape, arrows, or Tab
- **THEN** the toolbar SHALL NOT prevent the event's default behavior

### Requirement: Optional demo integration

The demo SHALL explicitly enable selection tools with exactly one owner in each integration mode. Library consumers SHALL retain opt-in behavior.

#### Scenario: Demo chooses an integration mode

- **WHEN** the Electron demo enables floating selection tools in legacy or runtime mode
- **THEN** exactly one floating toolbar SHALL be attached per eligible editor
- **AND** the existing global toolbar SHALL remain available
- **AND** the global and selection toolbar flags SHALL be independent
- **AND** formatting commands SHALL remain available when either or both toolbar UIs are disabled

### Requirement: Independent plugin ownership

The selection package SHALL expose its own runtime manifest and `SelectionToolbarLifecyclePlugin`. It SHALL depend only on editor and plugin infrastructure, not on `plugin-toolbar` or `plugin-formatting`. Runtime groups SHALL also accept direct host actions with the source editor, cancellation signal, and actual source button as their anchor. Runtime command buttons SHALL name existing command IDs; the selection plugin SHALL execute them against the source editor through `CommandService` without registering duplicate formatting commands. Dismissal, a new selection, document replacement, or disposal SHALL abort the pending invocation's signal.

#### Scenario: Global toolbar disabled

- **WHEN** the formatting provider and selection plugin are enabled without the global toolbar
- **THEN** the configured selection actions SHALL remain usable
- **AND** no global toolbar UI SHALL be mounted

#### Scenario: Custom action without formatting

- **WHEN** a host configures a direct custom action or a command from another provider
- **THEN** the selection toolbar SHALL execute it without requiring the formatting or global-toolbar packages

#### Scenario: Independent unload

- **WHEN** the selection plugin is unloaded
- **THEN** its UI and pending invocations SHALL be removed or cancelled
- **AND** formatting commands and global-toolbar UI SHALL remain available

#### Scenario: Choose or cancel text color in the demo

- **WHEN** a user opens text color for an eligible selection
- **THEN** the host-owned picker SHALL support pointer and keyboard color choice
- **AND** applying a color SHALL use shared formatting and preserve the inner text selection
- **AND** Escape SHALL close the picker without changing the document
- **AND** outside interaction, document replacement, or disposal SHALL abort and remove the picker
