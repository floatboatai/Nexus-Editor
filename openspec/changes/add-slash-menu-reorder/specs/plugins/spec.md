## ADDED Requirements

### Requirement: Slash Menu Reordering Is Opt-In

`plugin-slash` SHALL keep drag-to-reorder disabled by default. Hosts MUST explicitly enable it before the menu may render drag handles, reorder commands by manual placement, or read and write a persisted order. Reordering MAY be enabled with a boolean `true` flag for session-only ordering or with an options object for host-injected storage settings; omitting `reorderable` or passing `false` SHALL keep it disabled.

#### Scenario: Default menu renders no handles
- **WHEN** a host creates the slash menu without `reorderable`
- **AND** the slash menu opens
- **THEN** no `.{prefix}-menu__handle` element SHALL be rendered
- **AND** an empty-query menu SHALL render commands in the same order supplied by the editor state

#### Scenario: Session-only reordering is available when enabled without storage
- **WHEN** a host enables `reorderable: true` without a storage object
- **AND** the user drags a command to a new position
- **THEN** the current menu instance SHALL render the new order for the rest of the session
- **AND** no global `localStorage` write SHALL occur

### Requirement: Manual Order Composes After Recency Ordering

When both `history` and `reorderable` are enabled, `plugin-slash` SHALL apply recency ordering first and then apply the persisted manual order on top. Commands the user has manually placed SHALL win over recency ordering, and commands the user has never manually placed SHALL retain the relative order produced by the recency layer.

#### Scenario: Manually placed command outranks a recently used command
- **WHEN** `history` and `reorderable` are both enabled
- **AND** the persisted manual order is `["b", "a"]`
- **AND** the user has most recently confirmed command `c`
- **THEN** the empty-query menu SHALL render `["b", "a", "c", ...]`
- **AND** command `c` SHALL NOT be promoted above `a` or `b`

#### Scenario: Unplaced commands keep the recency layer order
- **WHEN** the persisted manual order is `["c"]`
- **AND** the recency layer produces `["b", "a", "c"]`
- **THEN** the rendered order SHALL be `["c", "b", "a"]`

### Requirement: Manual Order Applies To Empty Query Menus Only

`plugin-slash` SHALL apply the persisted manual order only when the slash query is empty. While a non-empty query filters the menu, the rendered order SHALL be the filtered order supplied by the editor state, and drag handles SHALL NOT initiate a drag.

#### Scenario: Filtered menus ignore the manual order
- **WHEN** `reorderable` is enabled and the persisted manual order is `["c", "a", "b"]`
- **AND** the user types a non-empty query
- **THEN** the rendered order SHALL follow the filtered order from the editor state
- **AND** dragging a handle SHALL NOT change the order

### Requirement: Reordering Uses Custom Pointer Drag

`plugin-slash` SHALL implement reordering with `mousedown`, `mousemove`, and `mouseup` listeners. It MUST NOT use the HTML5 drag-and-drop API (`draggable`, `dragstart`, `dragover`, `drop`) and MUST NOT set `draggable="true"` on menu items or handles.

#### Scenario: Item elements are not HTML5-draggable
- **WHEN** `reorderable` is enabled and the menu is open
- **THEN** neither the item element nor the handle element SHALL have `draggable="true"`
- **AND** the handle SHALL be the only element that initiates a reorder

### Requirement: Drag Is Clamped To The Visible List

A drag SHALL move exactly one command and SHALL clamp at both boundaries. Dragging above the first rendered position SHALL place the command at index `0`; dragging below the last rendered position SHALL place it at the last index. The rendered command list MUST NOT change length, MUST NOT gain duplicate ids, and MUST NOT lose entries as a result of a drag.

#### Scenario: Dragging above the first item clamps to the top
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user drags `c` above the first item
- **THEN** the rendered order SHALL be `[c, a, b]`
- **AND** the list SHALL still contain exactly three items

#### Scenario: Dragging below the last item clamps to the bottom
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user drags `a` below the last item
- **THEN** the rendered order SHALL be `[b, c, a]`
- **AND** the list SHALL still contain exactly three items

#### Scenario: A single-item menu does not start a drag
- **WHEN** the menu renders exactly one command
- **AND** the user presses the handle and moves the pointer
- **THEN** the rendered order SHALL be unchanged

### Requirement: Confirmation Stays Aligned With The Reordered List

After a drop, `plugin-slash` SHALL keep the rendered order, the highlight index, `visibleCommands`, and confirmation aligned. `Enter` and item clicks MUST confirm the command represented by the rendered active or clicked item, not the command that occupied the same index before the reorder. The dragged command SHALL become the highlighted item after the drop.

#### Scenario: Enter confirms the dropped command
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user drags `c` to the first position and releases
- **AND** the user presses `Enter`
- **THEN** command `c` SHALL be confirmed
- **AND** command `a` SHALL NOT be confirmed because it previously occupied index `0`

#### Scenario: Enter confirms the item active at drop time
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user drags `a` to the last position and releases
- **THEN** the highlighted item SHALL be `a`
- **AND** pressing `Enter` SHALL confirm command `a`

### Requirement: A Press Without Movement Is Inert

Pressing a handle and releasing it without moving the pointer SHALL NOT change the command order and SHALL NOT confirm the command. Reordering SHALL begin only after the pointer has moved beyond a small movement threshold.

#### Scenario: Clicking a handle does not confirm
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user presses the handle of `b` and releases without moving
- **THEN** the rendered order SHALL remain `[a, b, c]`
- **AND** no command SHALL be confirmed

### Requirement: An In-Flight Drag Cancels Without Persisting When The Menu Closes

`plugin-slash` SHALL cancel an active drag when the menu hides, is dismissed, or is destroyed. A cancelled drag MUST NOT persist an order. `Escape` pressed during a drag SHALL cancel the drag and restore the pre-drag order.

#### Scenario: Escape during a drag restores the previous order
- **WHEN** the menu renders `[a, b, c]`
- **AND** the user drags `c` to the first position without releasing
- **AND** the user presses `Escape`
- **THEN** the persisted order SHALL be unchanged
- **AND** reopening the empty-query menu SHALL render `[a, b, c]`

#### Scenario: Pointer release outside the menu commits the drop
- **WHEN** the user starts a drag on a handle and releases the pointer outside the menu element
- **THEN** the drop SHALL be committed at the clamped position
- **AND** the order SHALL be persisted when storage is configured

### Requirement: Persistence Uses Host-Injected Storage And Writes On Drop

Persistent slash command order SHALL use only a host-injected localStorage-like object. `plugin-slash` MUST NOT write to global `localStorage` by default. The order SHALL be written once per committed drop, not during pointer movement.

#### Scenario: Storage is written on drop only
- **WHEN** `reorderable` is enabled with host-injected storage
- **AND** the user drags a command across several positions and then releases
- **THEN** the storage write SHALL occur after the release
- **AND** the stored value SHALL contain the resulting command id order

#### Scenario: Explicit storage seeds the rendered order
- **WHEN** `reorderable` is enabled with host-injected storage
- **AND** storage contains command ids `["c", "a"]`
- **THEN** an empty-query menu with commands `[a, b, c]` SHALL render `[c, a, b]`

### Requirement: Persisted Order Merges With The Visible Window

The editor caps slash menu results at `slashMenuLimit` before the menu renders, so the menu observes only a prefix of the registered commands. On drop, `plugin-slash` SHALL rewrite the persisted order as the new visible order followed by previously stored ids that were not visible, preserving their previous relative order. A drop MUST NOT remove persisted ids for commands outside the visible window.

#### Scenario: Commands outside the visible window are preserved
- **WHEN** the persisted order is `["a", "b", "hidden"]`
- **AND** the visible menu renders `[a, b]` (the remainder is capped out)
- **AND** the user drags `b` above `a`
- **THEN** the persisted order SHALL become `["b", "a", "hidden"]`
- **AND** `hidden` SHALL NOT be dropped from storage

### Requirement: Unknown And Duplicate Ids Are Ignored

When reading a persisted order, `plugin-slash` SHALL ignore ids that are not present in the current command list. When writing, it SHALL deduplicate ids. Unknown or duplicated ids MUST NOT produce phantom menu items or duplicated rendered entries.

#### Scenario: Stale ids do not render phantom items
- **WHEN** the persisted order contains `["removed", "c"]`
- **AND** the current empty-query command list is `[a, b, c]`
- **THEN** the rendered order SHALL be `[c, a, b]`
- **AND** no item for `removed` SHALL be rendered

#### Scenario: Duplicate ids collapse to a single entry
- **WHEN** the persisted order contains `["c", "c", "a"]`
- **AND** the current empty-query command list is `[a, b, c]`
- **THEN** the rendered order SHALL be `[c, a, b]`
- **AND** exactly three items SHALL be rendered

### Requirement: Order Storage Failures Are Non-Fatal

`plugin-slash` SHALL treat order storage as best-effort. Invalid JSON, `getItem` exceptions, and `setItem` exceptions MUST NOT throw out of menu open, render, drag, or confirmation paths.

#### Scenario: Invalid JSON is ignored
- **WHEN** `reorderable` is enabled with storage whose value is invalid JSON
- **THEN** opening the slash menu SHALL NOT throw
- **AND** the menu SHALL render commands using the non-reordered order

#### Scenario: getItem throw is ignored
- **WHEN** `reorderable` is enabled with storage whose `getItem` throws
- **THEN** opening the slash menu SHALL NOT throw
- **AND** menus SHALL render normally

#### Scenario: setItem throw is ignored
- **WHEN** `reorderable` is enabled with storage whose `setItem` throws
- **AND** the user completes a drag
- **THEN** the drop SHALL NOT throw
- **AND** the rendered order for the current session SHALL still reflect the drop

### Requirement: Disabled Reordering Preserves Existing Interaction Semantics

When `reorderable` is disabled, `plugin-slash` SHALL preserve existing menu ordering and interaction behavior for keyboard navigation, Enter confirmation, click confirmation, and the `history` recency option.

#### Scenario: History behavior is unchanged when reordering is disabled
- **WHEN** history is enabled and `reorderable` is disabled
- **AND** the user confirms command `c` in an empty-query menu rendering `[a, b, c]`
- **THEN** the next empty-query menu SHALL render `[c, a, b]`
- **AND** no handle element SHALL be rendered
