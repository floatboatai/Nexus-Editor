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

## Sync-scroll preview primitives

Three low-level pieces for building a synced, read-only rendered preview pane alongside the editor (the electron demo's split-preview toggle is the reference implementation — see `apps/electron-demo/src/renderer/preview-panel.ts`):

```ts
import { renderPreviewHtml } from "@floatboat/nexus-core";

// Render the current AST to an HTML string. Every top-level block element
// carries a `data-offset` attribute (the block's source character offset) so
// a host can map scroll position back to a document location. No markdown
// re-parse — it transforms the AST you already have.
const html = renderPreviewHtml(editor.getAst());

// Fires at most once per animation frame while the editor's viewport
// scrolls. `offset` is the document offset at the top of the viewport;
// `ratio` (0–1) is how far scrolled within the rendered height of the
// document line at that offset (a line-based unit — see the note below).
editor.on("scroll", ({ offset, ratio }) => {
  // e.g. find the nearest `[data-offset]` element in your preview pane
  // and align it to the top of the pane.
});

// The write-side counterpart: scroll the editor so `offset` sits at the top
// of the viewport (optionally refined by `ratio`, in the same line-based
// unit the `scroll` event reports).
editor.scrollToOffset(offset, ratio);
```

Both directions stay in CM6's content-space height coordinates internally — no screen-coordinate math is required on the host side, and the CM6 `EditorView` itself is never exposed.

**Note on `ratio`**: it is a fraction of one document line's rendered height, **not** of a whole markdown block — only reuse it against something measured in the same unit (e.g. echoing one editor's `scroll` payload into another editor's `scrollToOffset`). When syncing against block-sized elements such as the `data-offset` blocks from `renderPreviewHtml`, align block tops and ignore `ratio` — that's what the demo's preview panel does.

**Known v1 limitation**: wiki-link (`[[...]]`) syntax is not a real mdast node (see `wikilinks.ts`), so `renderPreviewHtml` does not render it as a navigable link.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
