# @floatboat/nexus-core

Framework-agnostic Markdown editor engine powering Nexus-Editor — CodeMirror 6 + Lezer with Obsidian-style live preview. See the [repository README](../../README.md) for the full feature tour; this file documents core-specific public APIs.

## Install

```bash
pnpm add @floatboat/nexus-core
```

```ts
import { createEditor } from "@floatboat/nexus-core";

const editor = createEditor({
  container: document.querySelector("#editor")!,
  initialValue: "# Hello",
  livePreview: true,
});
```

## Multi-cursor / multi-selection

Opt-in via `multiCursor: true` (off by default — it swaps the native caret/selection rendering for CodeMirror-drawn layers):

```ts
const editor = createEditor({
  container,
  initialValue: "# Hello",
  multiCursor: true,
});
```

When enabled:

| Interaction | Effect |
|---|---|
| `Alt`+Click | Add a cursor at the clicked position |
| `Mod-d` | Select word under cursor, then next occurrence of the selection (VS Code style, wraps around) |
| `Mod-Alt-ArrowUp` / `Mod-Alt-ArrowDown` | Add a cursor on the previous / next line, column preserved |
| `Escape` | Collapse to the main selection (falls through to other Escape handlers when already single) |

`Mod` is `Cmd` on macOS and `Ctrl` elsewhere. Markdown niceties are multi-range aware: Enter continues lists/blockquotes at **every** cursor, and the `` ` `` / `**` / `~~` auto-pairing wraps every selection. Live preview reveals raw syntax at every cursor position.

The commands are exported standalone for hosts that want custom bindings, plus the bundled keymap and extension:

```ts
import {
  selectNextOccurrence,
  addCursorAbove,
  addCursorBelow,
  collapseToMainSelection,
  multiCursorKeymap,
  multiCursorExtension,
} from "@floatboat/nexus-core";
```

### Selections API

```ts
editor.getSelection();   // main range: { anchor, head }
editor.getSelections();  // all ranges: { ranges: [{ anchor, head }, ...], mainIndex }

editor.setSelection(5);                                  // single cursor
editor.setSelections([{ anchor: 2 }, { anchor: 9, head: 14 }]);  // multiple ranges
editor.setSelections([{ anchor: 2 }, { anchor: 9 }], 0);         // explicit main range

editor.on("selectionChange", ({ anchor, head, ranges, mainIndex }) => {
  // anchor/head describe the main range; ranges carries all of them
});
```

Multiple ranges in `setSelections` require `multiCursor: true` — without the flag CodeMirror collapses the selection to its main range.

## List editing

The bundled `markdownKeymap()` understands Markdown list structure (via the Lezer syntax tree), so the usual keys keep the source valid CommonMark:

| Interaction | Effect |
|---|---|
| `Enter` | Continue the list / blockquote at every cursor (a list inside a quote continues as `> - `); an empty item exits the list |
| `Tab` | Nest the item under its previous sibling, indented to that item's **content column** (`- ` → 2 spaces, `1. ` → 3, `10. ` → 4) |
| `Shift-Tab` | Lift the item to its parent's level; siblings that followed it become its children |
| `Backspace` at the start of an item's content | Nested item: same as `Shift-Tab`. Top-level item: drop the marker (and task box) and become plain text |

Nested children and continuation lines move with the item, consecutive selected siblings move together, and blockquote `> ` prefixes are preserved. Ordered lists in the affected tree are renumbered in the same transaction, so inserting or removing an item never leaves `1. 2. 2. 3.` behind — one undo step restores everything. A list keeps its written start number unless the command re-parented its first item. When no cursor is on a list item's marker line, `Tab` falls through to regular indentation.

List structure comes from the Lezer syntax tree, so a line that merely looks like `- item` inside a fenced code block is neither continued nor indented. Tab-indented lines are measured in columns using the editor's `tabSize` and rewritten with spaces when a command moves them. Pressing `Enter` with the cursor before an item's content pushes the whole item down a line instead of splitting its marker.

The commands are exported for hosts that want their own bindings:

```ts
import { indentListItem, outdentListItem, backspaceListItem, handleMarkdownEnter } from "@floatboat/nexus-core";
```

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
