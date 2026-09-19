# Change: Isolate undo history across document loads

## Why
Opening a file is recorded as an undoable edit. `loadDocument` loads disk content through `editor.setDocument(content, { silent: true })`, and `silent` only suppresses the `onChange` pipeline — the whole-document replacement still lands in the CM6 undo stack. Consequences a user hits immediately:

- Open a file, press Ctrl+Z before typing anything, and the buffer is reverted to the empty document that preceded the load (content appears deleted).
- Edit A, open B, press Ctrl+Z in B, and A's text is restored into B's buffer.
- Undo in B can also redo A's edits, because the redo stack survives the switch.

This is a data-presentation bug in the load path, not a request for new undo behavior.

## What Changes
- **ADDED** `SetDocumentOptions.history?: "record" | "skip" | "reset"` on `setDocument`, with `"record"` as the default so every existing programmatic-replacement call site keeps its current undo semantics (toolbar formatting, search replace-all).
  - `"skip"` — the replacement participates in history mapping but is not recorded as an undo entry.
  - `"reset"` — the replacement is not recorded **and** the undo and redo stacks are cleared, making the load an explicit document boundary. Implemented by routing the history extension through a per-editor compartment and rebuilding it.
- **ADDED** optional `NexusPlugin.historyCompartment` so the editor installs a plugin's history extension inside that compartment instead of the plain extension list. `createHistoryPlugin()` declares it.
- **MODIFIED** `apps/electron-demo` `EditorShell.loadDocument` to pass `history: "reset"`, so file open and file switch start a fresh history.
- **No breaking changes**: the option is additive and defaults to today's behavior; plugins that install `history()` themselves are unaffected.

## Impact
- Affected specs: editor-core
- Affected code: `packages/core/src/types.ts`, `packages/core/src/editor.ts`, `packages/plugin-history/src/index.ts`, `apps/electron-demo/src/renderer/editor-shell.ts`, `README.md`
- No new runtime dependencies; `Compartment` and `Transaction.addToHistory` come from `@codemirror/state`, a current `packages/core` dependency.
- Hosts that do not load `plugin-history` are unaffected: `history: "reset"` degrades to a no-op instead of throwing.
