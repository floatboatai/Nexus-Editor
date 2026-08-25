# Editor Core Spec

## ADDED Requirements

### Requirement: User-overridable keybindings

`EditorAPI` SHALL expose a discovery + override API for keybindings so hosts can build a settings UI that lets users rebind any plugin-declared shortcut or command hotkey without touching plugin source.

The API operates as a **two-layer merge**:

1. **Default layer** — every `NexusPlugin.shortcuts[]` entry and every `EditorCommand` with a `hotkey`, collected at `createEditor()` time and treated as immutable for the lifetime of the editor instance.
2. **User override layer** — replaced wholesale by `setUserKeybindings(overrides)`. Each override references a binding by its stable `id` (format: `plugin:<name>/command:<commandId>` for commands, `plugin:<name>/shortcut:<index>` for anonymous plugin shortcuts, `builtin:<module>/<name>` for built-in keymap entries), and either:
   - specifies a new `key` string (rebound), or
   - specifies `key: null` (unbound).

`getKeybindings()` SHALL return the merged view — every default entry, with its `key` field showing the override if one exists, and the untouched default in a `defaultKey` field. Two entries that resolve to the same `key` after merge SHALL both list each other in a `conflicts` array on the returned entries.

`keybindingsChange` SHALL fire once on `createEditor` completion (initial hydration) and once per `setUserKeybindings()` call — never per-entry.

#### Scenario: getKeybindings enumerates every plugin shortcut and command hotkey
- **WHEN** an editor is created with a plugin declaring one `shortcuts` entry and two `commands` (one with `hotkey`, one without)
- **THEN** `getKeybindings()` SHALL return two entries: one for the shortcut, one for the hotkey-bearing command
- **AND** the command without a hotkey SHALL be absent from the returned list

#### Scenario: getKeybindings tags each entry with a stable, source-bearing id
- **WHEN** a plugin named `test` declares a command `heading` with `hotkey: "Mod-1"` and an anonymous shortcut at index 0
- **THEN** `getKeybindings()` SHALL return an entry with `id: "plugin:test/command:heading"` for the command
- **AND** an entry with `id: "plugin:test/shortcut:0"` for the shortcut

#### Scenario: setUserKeybindings rebinds a command hotkey
- **WHEN** a plugin declares a command `heading` with `hotkey: "Mod-1"` and `setUserKeybindings([{ id: "plugin:test/command:heading", key: "Mod-h" }])` is called
- **THEN** pressing `Mod-h` SHALL invoke the command's `run` handler
- **AND** pressing `Mod-1` SHALL NOT invoke the command
- **AND** `getKeybindings()` SHALL return the entry with `key: "Mod-h"` and `defaultKey: "Mod-1"`

#### Scenario: setUserKeybindings with key: null unbinds
- **WHEN** `setUserKeybindings([{ id: "plugin:test/command:heading", key: null }])` is called
- **THEN** pressing the original key SHALL NOT invoke the command
- **AND** `getKeybindings()` SHALL return the entry with `key: null` and `defaultKey: "Mod-1"`

#### Scenario: setUserKeybindings with an empty array restores defaults
- **WHEN** overrides have been applied and `setUserKeybindings([])` is called
- **THEN** every entry SHALL revert to its `defaultKey`
- **AND** `keybindingsChange` SHALL fire exactly once for this call

#### Scenario: keybindingsChange fires once per setUserKeybindings call
- **WHEN** `setUserKeybindings([{ ... }, { ... }, { ... }])` is called with three overrides in one call
- **THEN** the `keybindingsChange` handler SHALL be invoked exactly once
- **AND** its payload SHALL include all three applied overrides in one merged snapshot

#### Scenario: Conflicts are surfaced on both sides
- **WHEN** two entries both resolve to `Mod-k` after override merge
- **THEN** `getKeybindings()` SHALL return each entry with a `conflicts` array containing the id of the other
- **AND** the `conflicts` array SHALL be empty for every entry that has no collision

#### Scenario: Unknown override id is ignored, not thrown
- **WHEN** `setUserKeybindings([{ id: "plugin:does-not-exist/command:x", key: "Mod-k" }])` is called
- **THEN** the call SHALL succeed without throwing
- **AND** `getKeybindings()` SHALL NOT invent an entry for the unknown id
- **AND** `keybindingsChange` SHALL still fire once (semantic: "the override snapshot was applied", even if partially inert)

#### Scenario: Initial keybindingsChange fires on editor creation
- **WHEN** an editor is created with plugins that declare shortcuts/hotkeys, and a `keybindingsChange` handler is registered before any `setUserKeybindings` call
- **THEN** the handler SHALL be invoked at least once during initial hydration with the default snapshot
