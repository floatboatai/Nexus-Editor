# @floatboat/nexus-plugin-history

Undo / redo for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor),
backed by CodeMirror 6 `history()`.

- **Keyboard** — `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`
- **Configurable grouping** — tune `newGroupDelay`, `minDepth`, or supply a
  custom `joinToEvent` predicate
- **Explicit boundaries** — `forceHistoryBoundary` / `withHistoryControl` so
  toolbar commands and multi-step edits don't silently merge with typing
- **Silent loads stay out of the stack** — core attaches
  `Transaction.addToHistory.of(false)` on `{ silent: true }`
  `setDocument` / `replaceRange` (file-open must never become Ctrl+Z)

## Install

```bash
pnpm add @floatboat/nexus-plugin-history @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello",
  plugins: [
    createHistoryPlugin({
      // Start a new undo group after 300ms of idle typing (CM6 default: 500).
      newGroupDelay: 300,
      minDepth: 100
    })
  ]
});

editor.undo(); // also available via the keymap
editor.redo();
```

## Grouping helpers

Use these when a plugin dispatches its own CM6 transactions and needs
deterministic undo behavior:

```ts
import {
  forceHistoryBoundary,
  notInHistory,
  withHistoryControl
} from "@floatboat/nexus-plugin-history";

// Never record this transaction (host seeding, external sync).
view.dispatch(
  withHistoryControl(
    { changes: { from: 0, to: 0, insert: "<!-- seeded -->\n" } },
    { addToHistory: false }
  )
);

// Force a hard undo-group boundary before a command runs.
view.dispatch({
  changes: { from, to, insert },
  annotations: forceHistoryBoundary("before")
});

// Equivalent annotation constant:
view.dispatch({
  changes: { from, to, insert },
  annotations: notInHistory
});
```

### When to isolate vs. rely on `newGroupDelay`

| Situation | Approach |
|---|---|
| Normal typing | Default time-based joining (`newGroupDelay`) |
| Toolbar / slash command that must be one Ctrl+Z | Single transaction (e.g. `editor.replaceRange`) — preferred |
| Multi-transaction command that must not merge with typing | `forceHistoryBoundary("before" \| "full")` |
| File open / external sync | `setDocument(md, { silent: true })` or `notInHistory` |

> **Tables:** cell typing is buffered in the live-preview widget and flushed
> as one document transaction on blur — that flush is already one undo entry.
> In-cell `Ctrl+Z` still uses the browser's contentEditable stack until blur;
> unifying those stacks is intentionally out of scope for this plugin.

## API

| Export | Description |
|---|---|
| `createHistoryPlugin(options?)` | Returns a `NexusPlugin` installing CM6 history + keymap |
| `HistoryPluginOptions` | `{ minDepth?, newGroupDelay?, joinToEvent? }` |
| `notInHistory` | `Transaction.addToHistory.of(false)` annotation |
| `forceHistoryBoundary(side?)` | `isolateHistory` annotation (`full` / `before` / `after`) |
| `withHistoryControl(spec, control)` | Merge the above into a `TransactionSpec` |
| `isolateHistory` / `historyKeymap` | Re-exports from `@codemirror/commands` |

## Roadmap

This package covers roadmap item **#8 — Undo / redo grouping**
(`docs/ROADMAP.md`). Coordinating deeper table-cell ↔ document undo
unification remains a follow-up.
