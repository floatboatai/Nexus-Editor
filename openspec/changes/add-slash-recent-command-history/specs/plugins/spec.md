## ADDED Requirements

### Requirement: Slash Recent Command History Is Opt-In

`plugin-slash` SHALL keep recently-used slash command ordering disabled by default. Hosts MUST explicitly enable slash command history before the menu may record command confirmations or reorder commands by recency. History MAY be enabled with a boolean `true` flag for session-only ordering or with an options object for host-injected storage settings; omitting history or passing `false` SHALL keep history disabled.

#### Scenario: Default menu order remains registration order
- **WHEN** a host creates the slash menu without history options
- **AND** the slash menu opens for an empty query
- **THEN** commands SHALL render in the same order supplied by the editor state
- **AND** no command history SHALL be recorded when a command is confirmed

#### Scenario: Enabled menu may reorder by command recency
- **WHEN** a host explicitly enables slash command history
- **AND** the user confirms a slash command
- **THEN** subsequent empty-query slash menus MAY place that command before commands without more recent usage

### Requirement: Slash History Tracks Commands, Not Queries

`plugin-slash` history SHALL record confirmed slash command ids only. It MUST NOT store slash query strings and MUST NOT restore prior `/query` input when the menu opens.

#### Scenario: Query text is not recalled
- **WHEN** history is enabled
- **AND** the user types `/hea` and confirms the `heading` command
- **THEN** the stored history SHALL contain the confirmed command id
- **AND** opening a later slash menu SHALL NOT restore `hea` or any previous slash query text

### Requirement: Disabled History Preserves Existing Interaction Semantics

When history is disabled, `plugin-slash` SHALL preserve existing menu ordering and interaction behavior for keyboard navigation, Enter confirmation, and click confirmation.

#### Scenario: Keyboard behavior is unchanged when disabled
- **WHEN** history is disabled
- **AND** the slash menu opens with commands `[a, b, c]`
- **THEN** `ArrowDown` SHALL move the highlight from `a` to `b`
- **AND** `ArrowUp` from `a` SHALL wrap to `c`
- **AND** `Enter` SHALL confirm the highlighted command from the original rendered order

#### Scenario: Click behavior is unchanged when disabled
- **WHEN** history is disabled
- **AND** the slash menu renders commands `[a, b, c]`
- **THEN** clicking the rendered `b` item SHALL confirm command `b`

### Requirement: Recent Ordering Applies To Empty Query Menus

When history is enabled, `plugin-slash` SHALL apply recently-used command ordering to empty-query menus. Commands with more recent usage SHALL appear before commands without more recent usage, while commands not present in history SHALL retain their existing relative order.

#### Scenario: Recently confirmed command moves to front
- **WHEN** history is enabled
- **AND** the menu opens for an empty query with commands `[a, b, c]`
- **AND** the user confirms command `c`
- **THEN** the next empty-query menu SHALL render `[c, a, b]`

#### Scenario: Non-history commands keep relative order
- **WHEN** stored history contains `[c]`
- **AND** the empty-query command list is `[a, b, c, d]`
- **THEN** the rendered order SHALL be `[c, a, b, d]`

### Requirement: Reordered Menus Confirm The Rendered Active Command

When history reorders visible commands, `plugin-slash` SHALL keep the rendered command list, highlight state, Enter confirmation, and click confirmation aligned. Confirmation MUST execute the command represented by the currently highlighted or clicked rendered item, not a command from the same index in the original editor state order.

#### Scenario: Enter confirms reordered active item
- **WHEN** history is enabled and orders commands as `[c, a, b]`
- **AND** the user presses `Enter` while `c` is highlighted
- **THEN** command `c` SHALL be confirmed
- **AND** command `a` SHALL NOT be confirmed because it occupied index `0` in the original command list

#### Scenario: Click confirms clicked reordered item
- **WHEN** history is enabled and renders commands as `[c, a, b]`
- **AND** the user clicks the rendered `a` item
- **THEN** command `a` SHALL be confirmed
- **AND** command `b` SHALL NOT be confirmed because it occupied the same original index before reordering

### Requirement: Host-Injected Storage Only

Persistent slash command history SHALL use only a host-injected localStorage-like storage object. `plugin-slash` MUST NOT write to global `localStorage` by default.

#### Scenario: Enabled history without storage is session-only
- **WHEN** history is enabled without a storage object
- **AND** the user confirms command `b`
- **THEN** the current menu instance SHALL be able to prioritize `b` during the same session
- **AND** no global `localStorage` write SHALL occur

#### Scenario: Explicit storage seeds command ordering
- **WHEN** history is enabled with host-injected storage
- **AND** storage contains command ids `["c", "a"]`
- **THEN** an empty-query menu with commands `[a, b, c]` SHALL render `[c, a, b]`

### Requirement: Storage Failures Are Non-Fatal

`plugin-slash` SHALL treat storage as best-effort. Invalid JSON, `getItem` exceptions, and `setItem` exceptions MUST NOT throw out of menu open, render, navigation, or confirmation paths.

#### Scenario: Invalid JSON is ignored
- **WHEN** history is enabled with storage
- **AND** the stored history value is invalid JSON
- **THEN** opening the slash menu SHALL NOT throw
- **AND** later confirming a command SHALL be able to write a valid history value if storage accepts writes

#### Scenario: getItem throw is ignored
- **WHEN** history is enabled with storage whose `getItem` throws
- **THEN** opening the slash menu SHALL NOT throw
- **AND** the menu SHALL render commands using normal non-history ordering

#### Scenario: setItem throw is ignored
- **WHEN** history is enabled with storage whose `setItem` throws
- **AND** the user confirms a command
- **THEN** confirmation SHALL NOT throw
- **AND** the command SHALL still execute through the normal confirmation path

### Requirement: Unknown Command Ids Are Ignored

When applying stored or session command history, `plugin-slash` SHALL ignore command ids that are not present in the current visible command list.

#### Scenario: Stale command ids do not render phantom items
- **WHEN** stored history contains `["removed", "c"]`
- **AND** the current empty-query command list is `[a, b, c]`
- **THEN** the rendered order SHALL be `[c, a, b]`
- **AND** no item for `removed` SHALL be rendered

### Requirement: History Dedupes To Front And Supports maxEntries

When command history records a confirmed command id, it SHALL remove any existing occurrence of that id, insert it at the front, and trim the stored list to `maxEntries`.

#### Scenario: Repeated command moves to front once
- **WHEN** current history is `["b", "c", "a"]`
- **AND** the user confirms command `c`
- **THEN** history SHALL become `["c", "b", "a"]`
- **AND** `c` SHALL appear only once

#### Scenario: maxEntries trims older ids
- **WHEN** `maxEntries` is `2`
- **AND** current history is `["b", "a"]`
- **AND** the user confirms command `c`
- **THEN** history SHALL become `["c", "b"]`
- **AND** command `a` SHALL be dropped from history
