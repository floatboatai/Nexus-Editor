# History Undo/Redo Grouping Design

**Date:** 2026-09-08

**Scope:** `packages/plugin-history` (Roadmap #8 — undo / redo 分组, scoped to input merge + explicit group API)

**Related:** `docs/ROADMAP.zh.md` §3 item 8

## Context

`@floatboat/nexus-plugin-history` is currently a thin wrapper around CodeMirror 6 `history()` + `historyKeymap`. Adjacent edits merge using CM6 defaults (`newGroupDelay` 500ms), but hosts and plugins have no first-class Nexus API to:

1. Tune grouping delay / history depth.
2. Isolate a batch of dispatches from neighboring history events (toolbar-style compound ops, demo scripts, etc.).

Roadmap #8 also notes table/`tableEditingCount` coordination. That work is intentionally **out of scope** for this change so a two-day contribution can ship complete, testable API surface without rewriting `live-preview-table.ts`.

## Goals

- Extend `createHistoryPlugin` with optional `HistoryPluginOptions` (`newGroupDelay`, `minDepth`) passed through to CM6 `history(config)`.
- Provide explicit helpers built on CM6 `isolateHistory`:
  - `runInHistoryGroup(view, fn)`
  - `withIsolatedHistory(spec, mode?)`
  - re-export `isolateHistory` for advanced callers
- Keep zero-argument `createHistoryPlugin()` behavior identical to today.
- Cover configuration and isolation with Vitest; keep existing Ctrl+Z / Ctrl+Y tests green.
- Document the API in package JSDoc (and a short README note if the package gains/updates README).

## Non-Goals

- Deep table-widget undo semantics / `tableEditingCount` integration (follow-up).
- A new history subsystem inside `packages/core` or the transaction pipeline.
- Forcing toolbar / slash / search plugins to call the new helpers in this PR.
- Persisted undo stacks across sessions; OT/CRDT collaboration.
- Guaranteeing that *N* dispatches inside `runInHistoryGroup` always collapse to **exactly one** undo entry. CM6 has no first-class “force single event” API; callers that need a single undo step should use one `dispatch` / `replaceRange` (existing core contract). The helpers guarantee **boundary isolation** from edits outside the group.

## Architecture

All work stays in `packages/plugin-history`:

```
packages/plugin-history/src/
  index.ts            # createHistoryPlugin + public exports
  history-group.ts    # runInHistoryGroup, withIsolatedHistory
test/
  plugin-history.test.ts
```

### Plugin factory

```ts
export interface HistoryPluginOptions {
  /** Max ms between adjacent events that may still merge. CM6 default: 500 */
  newGroupDelay?: number;
  /** Minimum history depth. CM6 default: 100 */
  minDepth?: number;
}

export function createHistoryPlugin(options?: HistoryPluginOptions): NexusPlugin;
```

Implementation: `cmExtensions: [history(options ?? {}), keymap.of(historyKeymap)]`.

Omit `joinToEvent` from the public options in this PR to keep the surface small; can be added later if hosts need word-boundary style undo.

### Explicit grouping

- `withIsolatedHistory(spec, mode = "full")`  
  Appends `isolateHistory.of(mode)` to the transaction `annotations` (preserving any existing annotations).

- `runInHistoryGroup(view, fn)`  
  1. Dispatch a no-op (or selection-preserving) transaction annotated `isolateHistory.of("before")` so prior history cannot merge into the group.  
  2. Run `fn(view)`.  
  3. Dispatch a closing boundary with `isolateHistory.of("after")`.  
  Edits *inside* the group still follow CM6 time/`userEvent` join rules relative to each other.

- Re-export `isolateHistory` from `@codemirror/commands`.

### Core / other packages

- Do **not** change `EditorHandle.undo` / `redo` (already delegate to CM6).
- Do **not** modify `live-preview-table.ts` in this PR.
- Optional demo usage in `electron-demo` is nice-to-have, not required for merge.

## Data flow

1. Host enables history via `createHistoryPlugin({ newGroupDelay?: number, minDepth?: number })`.
2. Normal typing / `dispatch` continues through CM6 history field; merge window follows `newGroupDelay`.
3. For a compound host operation: call `runInHistoryGroup(view, () => { /* dispatches */ })` or annotate individual specs with `withIsolatedHistory`.
4. User presses Ctrl+Z / calls `editor.undo()`; CM6 reverts one history event as usual.

## Error handling

- `runInHistoryGroup`: if `fn` throws, still attempt the closing `"after"` isolate dispatch (try/finally) so history state does not stay half-open.
- Helpers assume a live `EditorView`; destroyed editors are the caller’s responsibility (same as other CM6 plugins).

## Testing

| Case | Expectation |
|---|---|
| Existing keymap undo/redo | Unchanged |
| Default plugin (no options) | Still undoes last change |
| `withIsolatedHistory` | Spec annotations include `isolateHistory` with requested mode |
| `runInHistoryGroup` | Edits before the group and inside the group do not merge across the boundary (undo steps respect isolation) |
| Options object | `newGroupDelay` / `minDepth` accepted without throwing; plugin still installs |

Time-based merge assertions are flaky in CI; prefer annotation / boundary assertions over sleeping for `newGroupDelay` behavior unless a deterministic CM6 test hook is available.

## Acceptance criteria

1. Zero-arg `createHistoryPlugin()` behavior unchanged.
2. `HistoryPluginOptions` documented and typed.
3. `runInHistoryGroup` + `withIsolatedHistory` exported and tested.
4. Existing history tests remain green; new tests cover isolation.
5. PR description states Non-Goals (especially table coordination).

## Task checklist (implementation)

1. Add `HistoryPluginOptions` and wire `history(config)`.
2. Implement `history-group.ts` helpers; export from `index.ts`.
3. Extend `plugin-history.test.ts`.
4. JSDoc / short package docs.
5. Update roadmap #8 status when merging (`planned` → `done`).
6. Open PR with motivation, API summary, Non-Goals, test notes.

## Open follow-ups (not this PR)

- Table-aware grouping coordinated with `tableEditingCount`.
- Optional `joinToEvent` passthrough for word-level undo policies.
- Adopt `runInHistoryGroup` inside toolbar / multi-step commands where beneficial.
