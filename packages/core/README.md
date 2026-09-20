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

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.

## Headless HTML rendering (SSR / SSG)

`editor.exportHTML()` requires a mounted editor. The same pipeline is available
without a DOM for server-side rendering, static-site builds and scripts:

```ts
import { createHtmlRenderer, renderMarkdownToHtml } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

renderMarkdownToHtml("# Hello", { plugins: [createGfmPreset()] });
// => "<h1>Hello</h1>"

const renderer = createHtmlRenderer({ plugins: [createGfmPreset()] }); // build once
renderer.render(markdownA);
renderer.render(markdownB);
```

- `plugins` — the `NexusPlugin[]` you pass to `createEditor()`; only their
  `remarkPlugins` participate. Same plugins ⇒ same HTML as `exportHTML()`.
- `transform?: (tree: Root) => Root` — optional mdast hook applied after the
  remark plugins, before HTML conversion.
- Raw HTML nodes are dropped (remark-rehype default), so output is safe to embed.
- Live-preview widgets (mermaid, syntax highlighting, KaTeX) are not part of
  this pipeline; they render in the browser once the editor hydrates.
