# Implementation Tasks

## 1. Core types (`packages/core/src/types.ts`)
- [x] 1.1 Add `KeybindingSpec` (key + run + optional priority) and `KeybindingInfo` snapshot entry
- [x] 1.2 Add `EditorKeybindingRegistrationOptions` with bounded `priority`
- [x] 1.3 Extend `EditorExtensionContributionSink` with `registerKeybinding`
- [x] 1.4 Extend `EditorAPI` with `getKeybindings()`
- [x] 1.5 Extend `EditorConfig` with optional `keybindings`

## 2. Registry implementation (`packages/core/src/dynamic-contributions.ts`)
- [x] 2.1 Owner-scoped keybinding store with sequence + priority, flushed through the existing compartment pipeline (IME / mouse-gesture deferral inherited from `scheduleFlush`)
- [x] 2.2 Two precedence buckets: positive priority → `Prec.high`, zero/negative → default precedence appended after static extensions
- [x] 2.3 Registration handle: id, ownerId, `ready` settled post-install, idempotent async dispose
- [x] 2.4 Entry accessor for the EditorAPI snapshot; cleanup on destroy

## 3. Wiring (`packages/core/src/editor.ts`, `packages/core/src/index.ts`)
- [x] 3.1 Expose `registerKeybinding` on the combined contribution sink
- [x] 3.2 Implement `getKeybindings()` assembling builtin → host(high) → plugin-shortcut → plugin-command → host(default) in documented order
- [x] 3.3 Install `config.keybindings` through the registry after editor creation
- [x] 3.4 Export new types from the package index

## 4. Tests (`packages/core/test/keymap-registry.test.ts`)
- [x] 4.1 Registered binding consumes a matching keystroke; non-consuming run falls through
- [x] 4.2 Dispose removes the binding; re-registering the same key then works
- [x] 4.3 Duplicate keys allowed — deterministic winner by registration order at equal priority
- [x] 4.4 Positive-priority host binding preempts a plugin shortcut; default priority does not
- [x] 4.5 `getKeybindings()` returns all four sources in documented precedence order
- [x] 4.6 `config.keybindings` are installed at creation and visible in the snapshot
- [x] 4.7 Invalid arguments and destroyed-editor registration throw

## 5. Docs & bookkeeping
- [x] 5.1 Document the API in `packages/core/README.md`
- [x] 5.2 Note config passthrough in `packages/react/README.md` and `packages/vue/README.md`
- [x] 5.3 Flip ROADMAP #14 to `in-progress` with the change-id note
