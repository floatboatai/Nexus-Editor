# Change: Add customizable-keymap UI capability

## Why

Nexus currently exposes keyboard shortcuts through three unrelated surfaces: `NexusPlugin.shortcuts[]` (registered at plugin construction), `EditorCommand.hotkey` (bound at command declaration), and `EditorAPI.runShortcut(key)` (dispatch by exact key string). None of them let a **host** discover what keys are bound, rebind them for the current user, or persist those choices — the three prerequisites for a settings panel that says "click a row, press a new key". Roadmap #14 lists this capability as P2 and calls out the missing register / query API as the blocker.

Because the keymap is currently baked in at plugin load, hosts either accept the defaults or fork the plugin to change them. Any consumer building an Obsidian-class settings UI has to reimplement the concept from scratch, and cross-plugin conflicts (two plugins claiming `Mod-k`) are silently resolved by declaration order.

## What Changes

- **ADDED** `EditorAPI.getKeybindings(): KeybindingEntry[]` — returns every currently active keybinding sourced from plugin shortcuts, plugin commands, and the built-in markdown keymap, tagged with source id + origin.
- **ADDED** `EditorAPI.setUserKeybindings(overrides: KeybindingOverride[]): void` — replaces the user override layer, which is merged on top of plugin-supplied defaults on every dispatch. Same call clears overrides when passed `[]`.
- **ADDED** `EditorEventMap` entry `keybindingsChange: (entries: KeybindingEntry[]) => void` — fires when overrides are applied, so a settings UI can redraw without polling.
- **ADDED** capability spec `editor-core` requirement "User-overridable keybindings" — describes discovery, override merge, conflict resolution, and persistence contract.
- **ADDED** `KeybindingEntry` and `KeybindingOverride` type exports.

**Non-goals of this proposal**
- A React/Vue settings component. The SDK bindings will land in a follow-up once the core API is stable.
- Persistence of user overrides. Storage is host-side — the API only accepts a snapshot; hosts wire whatever store they use for other settings.
- Chord / multi-step bindings. CM6 supports them but they add UX surface (partial-match state, timeout) that shouldn't gate the core discovery/override work.

## Impact

- Affected specs: `editor-core` (ADDED requirement)
- Affected code:
  - `packages/core/src/types.ts` — `KeybindingEntry`, `KeybindingOverride`, `EditorEventMap.keybindingsChange`, three `EditorAPI` additions
  - `packages/core/src/editor.ts` — new override layer that sits between plugin shortcut/command registration and CM6's keymap compilation; emitter wiring
  - `packages/core/src/index.ts` — type re-exports
- **No breaking changes.** Existing plugin `shortcuts[]` / `commands[].hotkey` semantics unchanged when no overrides are set. `runShortcut(key)` continues to accept the raw key string.
- No new runtime dependencies.
