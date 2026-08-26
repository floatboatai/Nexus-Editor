## ADDED Requirements

### Requirement: Host Keybinding Registration
The editor SHALL expose `registerKeybinding(ownerId, binding, options?)` on its contribution sink, accepting a CM6 key string and a run handler, and returning an `EditorContributionRegistration` whose `ready` resolves only after the binding is physically installed in the live `EditorView` and whose `dispose` removes the binding idempotently.

#### Scenario: Runtime registration intercepts a keystroke
- **WHEN** a host registers a binding for `Mod-k` and the user presses `Mod-k`
- **THEN** the host handler runs, its `true` return consumes the event, and no lower-precedence handler for that key fires

#### Scenario: Dispose detaches the binding
- **WHEN** the registration returned by `registerKeybinding` is disposed
- **THEN** subsequent keystrokes no longer reach the handler, and re-registering the same key succeeds

#### Scenario: Registration is deferred during active interaction
- **WHEN** a keybinding is registered while IME composition or a table editing session is active
- **THEN** physical installation is deferred until the interaction ends, and `ready` resolves afterwards

### Requirement: Deterministic Duplicate Key Resolution
The system SHALL allow multiple keybindings for the same key string. Among bindings in the same precedence bucket it SHALL run them ordered by priority descending, then registration order ascending; a handler returning a falsy value SHALL fall through to the next binding.

#### Scenario: Same key registered twice at equal priority
- **WHEN** two owners register `Mod-k` with default priority and the user presses `Mod-k`
- **THEN** the earlier registration runs first, and if it returns `true` the later one does not run

### Requirement: Documented Precedence Tiers
Host keybindings with positive priority SHALL be installed above plugin shortcut and command-hotkey keymaps but below built-in Markdown key handling. Host keybindings with zero or negative priority SHALL be installed below all static keymaps. The relative order of existing static keymaps SHALL NOT change.

#### Scenario: Positive priority preempts a plugin shortcut
- **WHEN** a plugin binds `Mod-k` via `shortcuts` and a host registers `Mod-k` with priority greater than zero
- **THEN** the host handler wins while both remain registered

#### Scenario: Default priority never disturbs static bindings
- **WHEN** a host registers `Mod-k` without a priority while a plugin shortcut on `Mod-k` exists
- **THEN** the plugin shortcut still wins

### Requirement: Effective Keybinding Query
The editor SHALL expose `getKeybindings()` returning a plain-data snapshot of every effective binding — builtin, host, plugin-shortcut, and plugin-command sources — ordered by actual resolution precedence, with owner attribution for every entry.

#### Scenario: Snapshot reflects all sources in precedence order
- **WHEN** an editor runs with the builtin Enter handler, a plugin shortcut, a command hotkey, and host registrations in both priority tiers
- **THEN** `getKeybindings()` lists them in the order builtin → host(positive) → plugin-shortcut → plugin-command → host(non-positive), each with `key`, `source`, and `ownerId`

### Requirement: Declarative Initial Keybindings
`EditorConfig` SHALL accept optional `keybindings` installed through the same registry at creation time, attributed to owner `editor-config`, and the option SHALL flow through the React and Vue SDK configuration passthrough unchanged.

#### Scenario: Config-declared binding works out of the box
- **WHEN** an editor is created with `keybindings: [{ key: "Mod-e", run }]`
- **THEN** pressing `Mod-e` invokes the handler immediately after creation and the snapshot lists it under source `host` with ownerId `editor-config`
