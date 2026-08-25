# @floatboat/nexus-plugin-history

Undo and redo support for Nexus Editor, powered by CodeMirror history.

## Install

```bash
pnpm add @floatboat/nexus-core @floatboat/nexus-plugin-history
```

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  plugins: [createHistoryPlugin()]
});
```

The plugin registers the standard CodeMirror history keymap:

- `Mod-z` to undo
- `Mod-y` / `Mod-Shift-z` to redo

The core `EditorAPI` also exposes `editor.undo()` and `editor.redo()`, which use the same history stack.

## Grouping Options

Hosts can tune undo grouping without replacing the whole history extension:

```ts
const history = createHistoryPlugin({
  minDepth: 200,
  newGroupDelay: 0,
  joinToEvent(transaction, isAdjacent) {
    return isAdjacent;
  }
});
```

Options are passed through to CodeMirror history:

| Option | Description |
| --- | --- |
| `minDepth` | Minimum number of undo/redo events kept in history. |
| `newGroupDelay` | Maximum time in milliseconds for adjacent edits to join one undo event. Set `0` when every dispatch should be undoable independently. |
| `joinToEvent` | Predicate called while still inside `newGroupDelay` to decide whether a transaction joins the previous undo event. |
