# @floatboat/nexus-plugin-history

CodeMirror 6 undo/redo for Nexus Editor.

## Usage

```ts
import {
  createHistoryPlugin,
  runInHistoryGroup,
  withIsolatedHistory
} from "@floatboat/nexus-plugin-history";

// Default (CM6 built-in grouping)
createHistoryPlugin();

// Tune merge window / depth
createHistoryPlugin({ newGroupDelay: 500, minDepth: 100 });

// Isolate a batch of dispatches from surrounding history
runInHistoryGroup(view, (v) => {
  v.dispatch({ changes: { from: 0, insert: "Hello" } });
});

// Annotate a single transaction
view.dispatch(withIsolatedHistory({ changes: { from: 0, insert: "!" } }, "full"));
```

`runInHistoryGroup` isolates the group from edits before/after it. It does **not** force multiple inner dispatches into a single undo entry — use one `dispatch` / `replaceRange` when you need a single Ctrl+Z.
