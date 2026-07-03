# Tasks: add-customizable-keymap-ui

## Phase 1: Type surface

- [ ] 1.1 Add `KeybindingEntry` and `KeybindingOverride` interfaces to `packages/core/src/types.ts`
- [ ] 1.2 Add `keybindingsChange` to `EditorEventMap`
- [ ] 1.3 Add `getKeybindings` / `setUserKeybindings` signatures to `EditorAPI`
- [ ] 1.4 Re-export new types from `packages/core/src/index.ts`

## Phase 2: Core implementation

- [ ] 2.1 Introduce a `keymap-registry.ts` module: collects `NexusPlugin.shortcuts[]` + `EditorCommand.hotkey` into a normalized list at editor construction
- [ ] 2.2 Add a user-override layer that maps entry id 鈫?new key (or `null` for unbound), merged on every read
- [ ] 2.3 Rebuild CM6 keymap extension via `Compartment.reconfigure` when overrides change
- [ ] 2.4 Conflict resolution: if two entries collide on the same key after merge, the override takes precedence; unresolved defaults follow existing declaration-order semantics but surface a `conflicts: KeybindingEntry[]` field on the affected entries
- [ ] 2.5 Emit `keybindingsChange` after every applied override, and once on `createEditor` completion for initial hydration
- [ ] 2.6 Implement `EditorAPI.getKeybindings()` and `setUserKeybindings()`

## Phase 3: Tests

- [ ] 3.1 Unit test: `getKeybindings()` lists every plugin shortcut + command with correct source tagging
- [ ] 3.2 Unit test: `setUserKeybindings([{ id, key }])` rebinds a plugin command; pressing the new key triggers the original `run`
- [ ] 3.3 Unit test: `setUserKeybindings([{ id, key: null }])` unbinds and the original key becomes a no-op
- [ ] 3.4 Unit test: `keybindingsChange` fires exactly once per `setUserKeybindings()` call
- [ ] 3.5 Unit test: two overrides claiming the same key expose each other via `conflicts` on both entries
- [ ] 3.6 Unit test: overrides survive setDocument / silent load / theme change

## Phase 4: Documentation

- [ ] 4.1 Update `packages/core/README.md` with a "Custom keybindings" section
- [ ] 4.2 Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md`: mark #14 in-progress with a link to this change
- [ ] 4.3 Add a note in `AGENTS.md` (Testing Conventions) about testing keymap changes without brittle DOM key-event assertions

## Phase 5: Follow-up (out of scope for this PR)

- [ ] 5.1 React SDK: `useKeybindings()` hook and a headless `<KeybindingsEditor />` primitive 鈥?separate proposal
- [ ] 5.2 Vue SDK: `useKeybindings()` composable 鈥?separate proposal
- [ ] 5.3 Persistence adapter examples in `apps/electron-demo` 鈥?after 5.1 lands
- [ ] 5.4 Include built-in markdown keymap entries (Enter list continuation, tab indent) in `getKeybindings()` as read-only entries 鈥?open question in `design.md`
