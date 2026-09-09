# @floatboat/nexus-plugin-history

Undo / redo for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor),
built on CodeMirror 6 `history()` with an explicit **history grouping** helper
for multi-step host and plugin workflows.

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
  plugins: [createHistoryPlugin()]
});

editor.setDocument("# Hello world");
editor.undo(); // back to "# Hello"
editor.redo();
```

## Options

```ts
createHistoryPlugin({
  // Keep at least N undo events (CM default: 100)
  minDepth: 200,
  // Merge adjacent typing bursts within this window (CM default: 500ms)
  newGroupDelay: 250
});
```

## Grouping multi-step edits (`runInHistoryGroup`)

Core already guarantees **one transaction = one undo entry** for
`replaceRange()` and `dispatchTransactions([...])`.

Use `runInHistoryGroup` when a workflow must issue **multiple** dispatches
(for example several `replaceRange` calls on disjoint ranges) but should still
undo as a single user-facing step:

```ts
import { EditorView } from "@codemirror/view";
import {
  createHistoryPlugin,
  findEditorView,
  runInHistoryGroup
} from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container,
  plugins: [createHistoryPlugin()]
});

const view = findEditorView(container)!;

runInHistoryGroup(view, () => {
  editor.replaceRange(0, 5, "Hello");
  editor.replaceRange(20, 25, "world");
});

// One Ctrl+Z / editor.undo() reverts both replacements.
```

### How it works

1. The first transaction inside the callback is annotated with
   `isolateHistory("before")` so it does not merge with older history.
2. Every transaction is tagged with `historyGroupAnnotation`, and the plugin's
   `joinToEvent` forces those tagged edits to join — even when ranges do not
   touch.
3. After the callback, a no-op seal transaction uses `isolateHistory("after")`
   so the next user edit starts a fresh group **without** adding an extra undo
   entry.

Nested `runInHistoryGroup` calls reuse the outer group.

## When *not* to use it

| Goal | Prefer |
|---|---|
| Single range edit + selection move | `editor.replaceRange(...)` |
| Several changes known up-front as one batch | `editor.dispatchTransactions([...])` |
| Multi-step workflow with intermediate reads of the updated doc | `runInHistoryGroup(view, ...)` |

## Exports

- `createHistoryPlugin(options?)`
- `runInHistoryGroup(view, fn)`
- `findEditorView(dom)`
- `historyGroupAnnotation`
- `isolateHistory` / `undoDepth` / `redoDepth` (re-exported from `@codemirror/commands`)
