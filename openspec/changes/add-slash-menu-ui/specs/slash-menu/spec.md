# Slash Menu Spec — Floating UI

## ADDED Requirements

### Requirement: Floating Menu Mount and Lifecycle

The `@floatboat/nexus-plugin-slash` package SHALL export `createSlashMenuUI(editor, options?)` returning `{ element: HTMLElement; destroy(): void }`. The factory SHALL subscribe to the editor's `slashMenuChange` and `blur` events and SHALL append its root element to `options.container ?? document.body`. Calling `destroy()` SHALL detach the element, remove all subscriptions, and remove document-level listeners.

#### Scenario: Initial mount is hidden
- **WHEN** `createSlashMenuUI(editor)` is invoked against a freshly created editor whose document is empty
- **THEN** the returned element SHALL be attached to the document
- **AND** the element SHALL have `display: none` (or equivalent visibility off-state)

#### Scenario: Destroy cleans up listeners
- **WHEN** `destroy()` is called on the returned handle
- **THEN** the element SHALL be removed from its parent
- **AND** subsequent `slashMenuChange` emissions SHALL NOT throw or update DOM
- **AND** `document` SHALL no longer have the menu's keydown / pointerdown / composition listeners attached

### Requirement: Menu Open and Item Rendering

When `slashMenuChange` emits `isOpen === true` with at least one command and non-null `coords`, the menu SHALL become visible, render one element per command in the supplied order, and highlight the first item. Each menu item SHALL display the command's `title` and SHALL expose `data-slash-command-id` set to the command id.

#### Scenario: Open state renders items
- **WHEN** the editor emits a slashMenuChange with two commands `[Heading 1, Heading 2]`
- **THEN** the menu SHALL be visible with exactly two child item elements
- **AND** the first item SHALL be visually highlighted (e.g. via `aria-selected="true"` and a `.is-active` class)
- **AND** `aria-activedescendant` on the listbox SHALL reference the first item's id

#### Scenario: Open state with zero commands shows an empty hint
- **WHEN** the editor emits a slashMenuChange with `isOpen: true` but `commands: []`
- **THEN** the menu SHALL remain visible
- **AND** SHALL render a single non-interactive "No matches" placeholder

#### Scenario: Closed state hides the menu
- **WHEN** the editor emits a slashMenuChange with `isOpen: false`
- **THEN** the menu SHALL hide (display off-state)
- **AND** the placeholder text "No matches" SHALL NOT appear

### Requirement: Keyboard Navigation

While the menu is open, the global `keydown` handler SHALL intercept the following keys before they reach the editor: `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Tab`, `Escape`. While the menu is closed, the handler SHALL be inert and SHALL NOT swallow any keys.

#### Scenario: Arrow keys move highlight
- **WHEN** three items are rendered and the user presses `ArrowDown`
- **THEN** the second item SHALL become highlighted
- **AND** `aria-activedescendant` SHALL reference the second item's id
- **AND** the editor's content SHALL NOT receive the keypress

#### Scenario: Arrow keys wrap at the boundaries
- **WHEN** the first item is highlighted and the user presses `ArrowUp`
- **THEN** the last item SHALL become highlighted
- **AND** symmetrically `ArrowDown` from the last item SHALL highlight the first

#### Scenario: Home / End jump to extremes
- **WHEN** any non-first item is highlighted and `Home` is pressed
- **THEN** the first item SHALL be highlighted
- **AND** `End` SHALL highlight the last item

#### Scenario: Enter confirms the highlighted command
- **WHEN** the user presses `Enter` while the menu is open
- **THEN** the menu SHALL hide
- **AND** the `/query` trigger text in the document SHALL be replaced with an empty string
- **AND** the highlighted command's `run(editor)` callback SHALL be invoked exactly once

#### Scenario: Tab is an Enter alias
- **WHEN** the user presses `Tab` with the menu open
- **THEN** behaviour SHALL be identical to `Enter`

#### Scenario: Escape closes without invoking
- **WHEN** the user presses `Escape` with the menu open
- **THEN** the menu SHALL hide
- **AND** no `run` callback SHALL be invoked
- **AND** the `/query` text SHALL remain in the document

#### Scenario: Closed menu does not steal Tab
- **WHEN** the menu is closed and the editor is focused
- **AND** the user presses `Tab`
- **THEN** the editor's `indentWithTab` keymap SHALL receive the event normally

### Requirement: Mouse Interaction

The menu SHALL respond to mouse hover by syncing the highlight, to a left click on an item by confirming it, and to a `pointerdown` outside the menu by closing it. The click outside SHALL fire on `pointerdown` (not `click`) so that focus shifts and dismissal complete before any subsequent click is dispatched.

#### Scenario: Hover moves highlight
- **WHEN** the user hovers the third item
- **THEN** the third item SHALL be highlighted
- **AND** previous keyboard highlight state SHALL be overridden

#### Scenario: Click confirms
- **WHEN** the user clicks an item
- **THEN** behaviour SHALL match the keyboard confirm path: `/query` replaced, `run` invoked

#### Scenario: Click outside dismisses
- **WHEN** the menu is open and the user performs a `pointerdown` outside both the menu and the editor
- **THEN** the menu SHALL hide
- **AND** no `run` callback SHALL be invoked

### Requirement: Coordinate-Driven Placement With Viewport Flip

The menu SHALL be absolutely positioned at `state.coords.left, state.coords.bottom + 4px` by default. If the resulting bounding rect would extend beyond `window.innerHeight - 8`, the menu SHALL flip above the caret to `state.coords.top - menu.height - 4px`. Horizontal overflow on the right edge SHALL clamp the left coordinate (minimum 8 pixels from the viewport edge).

#### Scenario: Default placement is below the caret
- **WHEN** the caret coords place the menu well inside the viewport
- **THEN** the menu's top edge SHALL be at `coords.bottom + 4`

#### Scenario: Flip above when below would clip
- **WHEN** rendering at `coords.bottom + 4` would place the menu's bottom past the viewport bottom
- **THEN** the menu SHALL render with its bottom edge at `coords.top - 4`

#### Scenario: Right-edge clamp
- **WHEN** the caret is near the right edge and the menu would overflow horizontally
- **THEN** the menu's left coordinate SHALL be reduced so the menu fits inside the viewport with at least 8 px margin

#### Scenario: Null coords leaves the menu at its last position
- **WHEN** `state.isOpen === true` but `state.coords === null` (e.g. layout is mid-flight or the host is a layout-less environment such as JSDOM)
- **THEN** the menu SHALL still become visible
- **AND** SHALL retain its previous `left` / `top` styles
- **AND** the next emission with non-null `coords` SHALL reposition it without flicker

### Requirement: IME Composition Awareness

While a composition session is active on `document`, keyboard handlers SHALL suppress arrow / enter / tab / escape handling so the IME owns those keys. The state machine in `core` continues to update via `slashMenuChange` once the composition resolves.

#### Scenario: Keys ignored during composition
- **WHEN** a `compositionstart` event fires
- **AND** the user presses `Enter`
- **THEN** the menu SHALL NOT confirm
- **AND** the `Enter` SHALL propagate to the editor (or IME) normally

#### Scenario: Keys re-enabled after composition end
- **WHEN** `compositionend` fires
- **AND** the user presses `ArrowDown`
- **THEN** the highlight SHALL move as usual

### Requirement: Accessibility

The menu root SHALL carry `role="listbox"`; each item SHALL carry `role="option"` and `aria-selected` reflecting the highlight. `aria-activedescendant` on the listbox SHALL always reference the id of the currently highlighted item while the menu is open. The trigger / editor SHALL NOT receive focus changes — the editor retains focus throughout the menu lifecycle.

#### Scenario: Listbox role exposed
- **WHEN** the menu is open
- **THEN** the menu root element SHALL have `role="listbox"`
- **AND** every visible item SHALL have `role="option"`

#### Scenario: Highlighted item is aria-selected
- **WHEN** the third item is highlighted
- **THEN** only the third item SHALL have `aria-selected="true"`
- **AND** all other items SHALL have `aria-selected="false"` (or no value)

#### Scenario: Editor focus is preserved
- **WHEN** the menu opens
- **THEN** `document.activeElement` SHALL remain the editor's content DOM
- **AND** after confirm / dismiss, focus SHALL still be the editor's content DOM

### Requirement: Command Execution Strategy

On confirm the menu SHALL replace the document range `[state.from, state.to]` with the empty string via the public editor API, then SHALL execute the chosen command in this order of precedence:
1. `options.onCommand(cmd, ctx)` if the host supplied one — full override, no fallback;
2. `cmd.run(editor)` if defined;
3. Otherwise, no-op (menu closes silently).

The replaced range SHALL be removed **before** invoking the command so a command that inserts content at the caret does not have to know about the slash trigger.

#### Scenario: Host override takes precedence
- **WHEN** `createSlashMenuUI(editor, { onCommand })` is constructed
- **AND** the user confirms a command that has a `run` callback
- **THEN** `onCommand` SHALL be invoked with the command and context
- **AND** the command's own `run` SHALL NOT be invoked

#### Scenario: Built-in run is invoked when no override
- **WHEN** no `onCommand` is supplied
- **AND** the user confirms `{ id: "h1", run: r }`
- **THEN** `r(editor)` SHALL be invoked exactly once
- **AND** the `/query` slice SHALL have been removed from the document beforehand

#### Scenario: No run and no override is a silent no-op
- **WHEN** the user confirms a metadata-only command
- **AND** no `onCommand` is supplied
- **THEN** the `/query` slice SHALL still be removed
- **AND** the menu SHALL close
- **AND** no error SHALL be thrown
