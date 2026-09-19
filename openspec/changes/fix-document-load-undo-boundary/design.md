## Context

`setDocument` is the single whole-document replacement primitive on `EditorAPI`. It has two callers with opposite requirements:

| Caller | Example | Requirement |
|---|---|---|
| A programmatic user edit | `plugin-toolbar` formatting, `plugin-search` replace-all, `apps/electron-demo` image drag-resize | The edit must be undoable — Ctrl+Z has to take it back |
| A document load | `EditorShell.loadDocument`, controlled `value` sync in `packages/react` / `packages/vue` | The load must not be undoable — Ctrl+Z must never erase an opened file |

Today both collapse into one behavior: any non-empty change set is recorded by the CM6 history field unless the transaction carries `Transaction.addToHistory.of(false)`. `silent` does not help — it only suppresses the `onChange` / `change` event and the AST resync (`packages/core/src/editor.ts`, `silentDocChange` annotation), and it is also used by the framework bindings for controlled-value sync, which must **not** silently drop user history.

There is also no existing spec for this: `openspec/specs/` contains only plugin-* capabilities, and the archived `plugin-editor-extensions` spec only requires that reconfiguration preserve "compatible undo/redo history". The load-boundary behavior was never specified, which is why the bug shipped with all 7 existing history/editor-demo tests green.

## Goals / Non-Goals

- Goals
  - Make the document-load boundary explicit and opt-in, without changing any existing call site's behavior.
  - Guarantee that undo/redo cannot cross a document load in either direction.
  - Keep the fix inside `packages/core` + the demo caller: no new dependency, no new package, no plugin API surface.
- Non-Goals
  - Undo/redo *grouping* (Roadmap item 8) — merging adjacent edits into fewer entries is a separate change.
  - Multi-document history stacks or per-file history restoration. `"reset"` discards history; restoring a previous document's history is not attempted.
  - Changing the history behavior of `replaceRange` or `replaceSelection`. Range edits stay `"record"`-only in this change so the surface stays minimal.

## Decisions

### Decision: a three-valued `history` option rather than a boolean

`"record" | "skip" | "reset"` names three genuinely different intents, and a boolean (`resetHistory: true`) cannot express the middle one. The middle case is not hypothetical: a host that renders external content (sync pull, formatter, test harness) wants the incoming text to be visible to subsequent undo mapping without itself becoming an undo step.

- Alternative considered: `resetHistory?: boolean` — rejected, cannot express `"skip"`, and `false` would be indistinguishable from the default.
- Alternative considered: a separate `editor.resetHistory()` method plus `setDocument(..., { skipHistory: true })` — rejected as two coordinated calls for one intent. Two dispatches also reintroduce the ordering hazard that `add-selection-api` already fixed for edits: a caller that forgets the second call silently keeps the bug.

### Decision: default stays `"record"`

`setDocument` is used for user-initiated edits in `packages/plugin-toolbar` (6 sites) and `packages/plugin-search` (2 sites). Those are covered by regression tests that assert a single Ctrl+Z reverts a toolbar toggle (`packages/plugin-toolbar/test/plugin-toolbar.test.ts`, "toggleUnorderedList — atomic undo"). Flipping the default to `"skip"` would break undo for formatting commands, so the load caller opts in instead.

### Decision: reset is a two-transaction compartment toggle, not a field write

Clearing the stacks turned out to be the hard part, and three plausible approaches were measured against a real CodeMirror state before choosing. Only one works:

1. `Transaction.addToHistory.of(false)` stops the load from *becoming* an entry, but explicitly does not clear what is already on the stack — CM6 maps the change through `state.addMapping(tr.changes.desc)` and keeps every earlier entry. Undo still reverts to the pre-load document. **Rejected on its own.**
2. `isolateHistory.of("full")` bounds the *redo* stack only. Measured: after loading B over an edited A, `done` still held the A edit and undo produced `"BA"`. **Rejected.**
3. `historyField.init(factory)` looks like the way to supply a replacement value, but it returns an *extension array* (`[field, initField.of(...)]`), not a dispatchable `StateEffect` — `initField` is a facet consulted on the field's create/reconfigure path. Passing it as an effect throws `effect.is is not a function`. **Rejected; the API for writing a live field value does not exist.**
4. **Chosen:** rebuild the extension itself. Reconfiguring the history compartment to `[]` drops the history field (and both stacks); reconfiguring it back to the plugin's `history()` re-creates it empty.

A CodeMirror compartment keeps only the **last** `reconfigure` in a transaction — measured directly — so the toggle cannot be a single dispatch. `performSetDocument` therefore issues two dispatches for `"reset"`: an effects-only dispatch that drops the extension, then the load transaction that installs a fresh instance. Both run synchronously in the same task with no input handling between them, so nothing can slip into the gap. The load transaction still carries `addToHistory(false)`, which keeps the replacement itself out of the rebuilt stack.

- Alternative considered: `view.setState(EditorState.create({ doc, extensions: state.config.extensions }))` — this does clear the stacks, but rebuilds every view plugin, losing scroll position, focus, and widget DOM. Rejected as disproportionate for a file open.
- Alternative considered: drain the stack with `while (editor.undo()) {}` — rejected. It is O(history depth) dispatches, each rebuilding decorations and firing `selectionChange`, and it reads as a workaround rather than a boundary.

### Decision: history extensions go through the compartment *exclusively*

The first working draft kept the plugin's `cmExtensions` in the plain extension list **and** installed a copy inside the compartment. Resetting then cleared only the compartment copy while the duplicate kept the history field — and its stacks — alive, so `"reset"` silently did nothing even though the disable dispatch ran. Measured on the real editor: `historyExtensions: 2, hasDisable: true` and yet `undone=1` after the load.

Declaring `historyCompartment: true` therefore *moves* a plugin's extensions into the compartment rather than copying them: the editor filters those plugins out of the plain list. This is the load-bearing part of the design and is pinned by the `"reset"` regression tests.

### Decision: the compartment is per-editor

Each `createEditor` call creates its own `Compartment`. CodeMirror computes compartment values per state, so a shared instance was measured **not** to leak across editors — resetting one editor left another's `done`/`undone` stacks intact. A per-editor instance is still the right contract: it makes "this editor owns its history slot" structural instead of incidental, and it keeps a plugin-level singleton from becoming the thing that breaks if a future CodeMirror version resolves compartments differently.

Plugins opt in with `historyCompartment?: true`, and `createHistoryPlugin()` sets it. Plugins that install `history()` themselves keep working unchanged and simply keep their history across document loads.

- Alternative considered: exporting a factory so plugins could create the compartment and hand it back — rejected as a wider public API with an ordering hazard for no additional capability.
- Alternative considered: an internal marker that does not appear on `NexusPlugin` — rejected as hidden coupling; a documented optional field is honest about the contract.

### Decision: no new dependency

Everything used is already exported by current dependencies: `Compartment` and `Transaction.addToHistory` from `@codemirror/state`, which `packages/core` already depends on. `@codemirror/commands` is not even needed for the reset path. This change adds no `dependencies` entry, so `GOVERNANCE.md` §6.3 does not apply.

## Risks / Trade-offs

- **Toggling a third-party extension off and back on** → Uses only documented `Compartment` behaviour, and the resulting semantics are locked by regression tests covering first load, load-after-undo, load-after-edit, and no-history-plugin. If `@codemirror/commands` ever exposes a supported reset, this can be simplified.
- **A plugin declaring `historyCompartment` moves its extensions into the compartment** → The contract is documented on `NexusPlugin.historyCompartment` and covered by the `"reset"` tests; a plugin that both declares it and expects its extensions on the plain path would notice immediately, because its history would reset on load.
- **`"reset"` degrades to a no-op when no history plugin is installed** → `historyExtensions` is empty, so the editor skips both dispatches instead of reconfiguring. A host without history has no stacks to clear, and the option is documented as a no-op there.
- **A host that expects file-switch undo** → This is the bug being fixed, and the option is opt-in, so only `EditorShell.loadDocument` changes behavior. The framework bindings keep their current controlled-sync semantics.
- **Two existing `plugin-history` tests assert the buggy assumption** → They are re-pointed to `history: "record"` so the test keeps covering "a recorded replacement is undoable" while a new case covers the boundary. Re-pointing is deliberate, not test-fitting, and it is called out in the PR description.
- **Undo across `"skip"` loads** → A `"skip"` load is still mapped, so position mapping is the only expectation; the scenario pins that a later `"record"` edit undoes to the skipped content, not past it.
- **Two dispatches instead of one for `"reset"`** → Visible to any transaction filter that counts dispatches per `setDocument` call. Accepted: it is the only way to express the toggle, and both dispatches happen inside one synchronous call.

## Migration Plan

Additive and opt-in. `EditorShell.loadDocument` is the only call site that switches to `"reset"`; every other caller keeps `"record"` by default and needs no change. No data migration, no serialized-state format change, no public API removal. Rollback is reverting the option plumbing — the default path is untouched.

## Open Questions

- Should `replaceRange` grow the same option? Deferred deliberately: no caller needs it today, and adding it later is a compatible change. Recorded here so the omission is a decision rather than an oversight.
- Should a `"reset"` load also reset scroll position or folding state? Out of scope; the load path already owns viewport behavior in the demo shell.
