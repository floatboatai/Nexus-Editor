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

## Wiki links

`createWikilinksPlugin` / `createWikilinksExtension` render Obsidian-style `[[target]]` chips. Hosts supply `resolve`, `onNavigate`, and optional `suggest`. Heading and block anchors are first-class:

```ts
import {
  createWikilinksPlugin,
  collectMarkdownHeadings,
  collectMarkdownBlockIds,
} from "@floatboat/nexus-core";

createWikilinksPlugin({
  resolve: (name) => index.resolve(name),
  onNavigate(target, { unresolved, path, anchor }) {
    // `[[#Setup]]` → path "", anchor { kind: "heading", value: "Setup" }
    // `[[Guide#Setup]]` → path "Guide", same anchor
  },
  suggest: (query) => index.noteNames(query),
  suggestAnchors: ({ path, kind, query }) => {
    const content = path ? index.read(path) : editor.getDocument();
    const items = kind === "heading"
      ? collectMarkdownHeadings(content)
      : collectMarkdownBlockIds(content);
    return items.filter((item) => item.toLowerCase().includes(query.toLowerCase()));
  },
});
```

`scanWikiLinks`, `parseWikiLinkTarget`, `findAnchorPosition`, `collectMarkdownHeadings`, and `collectMarkdownBlockIds` are pure helpers for hosts that keep their own link index. `findAnchorPosition` returns `null` when the heading or block id is missing — hosts should open the note without creating a file or moving the caret.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
