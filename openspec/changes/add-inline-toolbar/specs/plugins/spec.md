## ADDED Requirements

### Requirement: Inline Formatting Toolbar Appears On Non-Empty Selection

`plugin-toolbar` SHALL provide `createInlineToolbarUI(editor, options)` that mounts a floating toolbar shown when the editor reports a non-empty text selection. The toolbar SHALL remain hidden while the selection is collapsed and SHALL hide when the selection collapses.

#### Scenario: Toolbar is hidden by default

- **WHEN** a host creates the inline toolbar without any user selection
- **THEN** the toolbar element SHALL be attached to its container with `display: none`

#### Scenario: Toolbar appears when text is selected

- **WHEN** the editor reports a selection whose `anchor` differs from `head`
- **THEN** the toolbar SHALL become visible

#### Scenario: Toolbar hides when the selection collapses

- **WHEN** the selection is non-empty and the toolbar is visible
- **AND** the selection collapses to a caret
- **THEN** the toolbar SHALL hide

### Requirement: Inline Toolbar Positions Above The Selection With Viewport Flip

The inline toolbar SHALL position itself centered above the current selection using `editor.getCoordsAtPos()`. When the toolbar would clip the top of the viewport, it SHALL flip below the selection. When it would clip the right edge, it SHALL clamp inside the viewport.

#### Scenario: Default placement is above the selection

- **WHEN** the selection has valid coordinates and there is room above
- **THEN** the toolbar SHALL be positioned with its bottom edge above the selection's top edge, offset by the configured `offset`

#### Scenario: Flip below when no room above

- **WHEN** positioning above the selection would place the toolbar outside the viewport's top margin
- **AND** there is room below the selection
- **THEN** the toolbar SHALL be positioned below the selection

### Requirement: Inline Toolbar Default Groups Are Inline-Only

The default `groups` for `createInlineToolbarUI` SHALL include only inline-relevant formatting actions (bold, italic, strikethrough, inline code, insert link). Block-level commands (headings, lists, blockquote, code block) SHALL NOT appear in the default inline toolbar.

#### Scenario: Default toolbar renders inline actions only

- **WHEN** a host creates the inline toolbar with default options
- **AND** the user selects a non-empty range
- **THEN** the rendered buttons SHALL be `bold`, `italic`, `strikethrough`, `inline-code`, `link`

### Requirement: Inline Toolbar Buttons Reuse Existing Toolbar Action Types

The inline toolbar SHALL reuse the `ToolbarButton` and `ToolbarGroup` types from `createToolbarUI`. Hosts MAY supply custom `groups` to compose their own button set; button clicks SHALL invoke the button's `action(editor)` callback.

#### Scenario: Custom groups render their buttons

- **WHEN** a host supplies `groups: [{ buttons: [{ id, title, icon, action }] }]`
- **AND** the user selects a non-empty range
- **THEN** the rendered buttons SHALL match the supplied group's buttons in order

#### Scenario: Button click invokes action with the editor

- **WHEN** the user clicks an inline toolbar button
- **THEN** the button's `action` SHALL be invoked with the editor instance
- **AND** the editor SHALL retain focus so subsequent keystrokes flow into the document

### Requirement: Inline Toolbar Dismisses On Escape, Outside Click, And Editor Blur

The inline toolbar SHALL hide when the user presses `Escape`, when a `mousedown` lands outside the toolbar element, or when the editor emits `blur`. After dismissal, the toolbar SHALL NOT reappear for the same selection; a fresh non-empty selection SHALL clear the dismiss latch and show the toolbar again.

#### Scenario: Escape dismisses

- **WHEN** the toolbar is visible
- **AND** the user presses `Escape`
- **THEN** the toolbar SHALL hide

#### Scenario: Outside mousedown dismisses

- **WHEN** the toolbar is visible
- **AND** a `mousedown` lands on an element outside the toolbar
- **THEN** the toolbar SHALL hide

#### Scenario: Re-selection clears the dismiss latch

- **WHEN** the toolbar was dismissed by `Escape`
- **AND** the user makes a fresh non-empty selection
- **THEN** the toolbar SHALL become visible again

### Requirement: Inline Toolbar Suppresses During IME Composition

The inline toolbar SHALL NOT show while the editor is in IME composition. When composition ends, the toolbar SHALL re-evaluate visibility based on the current selection.

#### Scenario: Composition suppresses show

- **WHEN** a `compositionstart` event is active
- **AND** the user selects a non-empty range
- **THEN** the toolbar SHALL remain hidden

#### Scenario: Composition end re-evaluates

- **WHEN** composition ends
- **AND** the current selection is non-empty
- **THEN** the toolbar SHALL become visible

### Requirement: Inline Toolbar Repositions On Viewport Changes

The inline toolbar SHALL reposition itself when the host window is resized or scrolled, so the toolbar stays anchored to the selection.

#### Scenario: Resize repositions

- **WHEN** the toolbar is visible
- **AND** the host window dispatches a `resize` event
- **THEN** the toolbar SHALL recompute its position from the current selection coordinates

### Requirement: Inline Toolbar Destroy Detaches All Listeners

`InlineToolbarUI.destroy()` SHALL remove all DOM listeners, detach the toolbar element from its parent, and stop reacting to editor events. It SHALL be safe to call multiple times.

#### Scenario: Destroy detaches the element

- **WHEN** the host calls `destroy()` on a visible inline toolbar
- **THEN** the toolbar element SHALL be removed from its parent
- **AND** subsequent editor selection changes SHALL NOT throw

### Requirement: Inline Toolbar Supports Custom Container And Class Prefix

`createInlineToolbarUI` SHALL accept a `container` to mount the toolbar in a custom element (including `ShadowRoot` hosts) and a `classPrefix` to namespace the generated class names for host-side styling.

#### Scenario: Custom container receives the toolbar element

- **WHEN** a host supplies a `container` element
- **THEN** the toolbar element SHALL be appended to that container

#### Scenario: Custom class prefix namespaces generated classes

- **WHEN** a host supplies `classPrefix: "my-toolbar"`
- **THEN** the toolbar root SHALL carry the class `my-toolbar`
- **AND** buttons SHALL carry the class `my-toolbar-btn`
