# Change: Add host keybinding registration and query API

## Why
Every keybinding in the editor is installed statically at `createEditor` time: the built-in Markdown Enter handler, plugin `shortcuts`, and command `hotkey`s are baked into one immutable extension array (`packages/core/src/editor.ts`). Hosts that need runtime keybinding control — a user-facing "customize shortcuts" settings panel, an Electron host rebinding commands per workspace, or a plugin host installing bindings after boot — currently have no supported path. They can push raw CodeMirror `keymap` extensions through `getContributionSink().registerExtension()`, but with no precedence contract relative to plugin keymaps, no queryable snapshot of what is bound, and no owner-scoped disposal semantics.

This is the prerequisite step recorded in `docs/ROADMAP.md` item #14 ("Custom keymap UI — react/vue + core — Need to expose keymap register / query API first"). The UI layer itself stays out of scope here.

## What Changes
- **ADDED** `sink.registerKeybinding(ownerId, binding, options?)` on `EditorExtensionContributionSink` — registers a runtime keybinding returning the standard `EditorContributionRegistration` (owner-scoped id, `ready` resolving after physical installation, idempotent `dispose`)
- **ADDED** `editor.getKeybindings(): KeybindingInfo[]` on `EditorAPI` — unified snapshot of every effective binding across all four sources (builtin / host / plugin-shortcut / plugin-command), ordered by documented precedence so hosts can build conflict-detection UI without reimplementing CM6 resolution rules
- **ADDED** `EditorConfig.keybindings?: readonly KeybindingSpec[]` — declarative initial bindings installed through the same registry at creation time; flows into React/Vue SDK types via the existing `UseEditorConfig` passthrough (no binding-code changes required)
- **ADDED** duplicate-key policy: registering the same CM6 key twice is allowed; resolution is deterministic (priority desc, then registration order) and observable through `getKeybindings()`
- **NOT changed**: precedence of existing static keymaps, plugin `shortcuts`/`hotkey` semantics, or any public behavior for consumers who do not opt in

## Impact
- Affected specs: editor-core
- Affected code: `packages/core/src/types.ts`, `packages/core/src/dynamic-contributions.ts`, `packages/core/src/editor.ts`, `packages/core/src/index.ts`; docs in `packages/*/README.md`, `docs/ROADMAP.md`
- **No breaking changes** — purely additive; hosts ignoring the new API see identical behavior
