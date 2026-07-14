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

## Scroll sync & source-mapped HTML export

Building a split preview ("editor left, rendered HTML right")? Core ships the three pieces (ROADMAP #13):

**1. Source-mapped export.** `exportHTML({ sourceMap: true })` stamps block elements with the character range of the markdown they came from (`data-nexus-from` / `data-nexus-to` — the attribute names are exported as `SOURCE_MAP_FROM_ATTR` / `SOURCE_MAP_TO_ATTR`). Container blocks (lists, blockquotes) are descended into so outline-style documents get one anchor per item, not one per outline. Plain `exportHTML()` output is unchanged. The underlying `rehypeSourceMap` plugin is exported for custom unified pipelines.

```ts
editor.exportHTML({ sourceMap: true });
// <h2 data-nexus-from="8" data-nexus-to="14">Two</h2> ...
```

**2. Scroll position APIs.**

```ts
editor.on("scroll", () => { ... });   // editor scroll container scrolled
editor.getScrollAnchor();             // doc offset at the viewport's top edge
editor.scrollToAnchor(offset);        // inverse: put `offset` at the top edge
```

Both anchor methods interpolate inside the top line block, so tall wrapped lines and replaced widgets map smoothly instead of snapping per line.

**3. Bidirectional sync.** `createScrollSync` wires an editor to a container holding source-mapped HTML. Scroll either side and the other follows; block-to-block linear interpolation keeps content that renders at a different height (code fences, tables) aligned, and a driver lock suppresses feedback loops.

```ts
import { createScrollSync } from "@floatboat/nexus-core";

const preview = document.querySelector("#preview")!; // scrollable element
preview.innerHTML = editor.exportHTML({ sourceMap: true });

const sync = createScrollSync({ editor, preview });

editor.on("change", () => {
  preview.innerHTML = editor.exportHTML({ sourceMap: true });
  sync.refresh(); // re-measure the new blocks and re-align the preview
});

sync.destroy(); // detach all listeners
```

The mapping primitives (`collectScrollSyncAnchors`, `sourceOffsetToPreviewTop`, `previewTopToSourceOffset`) are exported for hosts that need custom behaviour — e.g. click-in-preview-to-jump. To theme host UI outside the editor's DOM (the editor scopes its CSS variables to itself), `themeToCssVars(theme)` returns the `--nexus-*` variable map to apply to your own container. The electron demo's split preview (`apps/electron-demo/src/renderer/preview-pane.ts`) is a complete reference integration.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
