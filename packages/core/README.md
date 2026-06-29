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

## Widget API

Plugins render custom DOM over mdast source ranges through `NexusPlugin.widgets`. Widgets stay views over the Markdown text: when the selection intersects a widget's source range it disappears and the raw Markdown becomes editable again.

```ts
import type { NexusPlugin } from "@floatboat/nexus-core";

const myWidgetPlugin: NexusPlugin = {
  name: "my-widget",
  widgets: [
    {
      nodeType: "code",
      match: (node) => node.lang === "mermaid",
      display: "block",        // "block" | "inline"  (canonical; replaces legacy `block`)
      eventPolicy: "widget",   // "widget" | "editor" (canonical; replaces legacy `ignoreEvents`)
      render(node, source, ctx) {
        const el = document.createElement("div");
        el.textContent = source;
        // enter raw-Markdown editing from a custom affordance:
        el.querySelector(".edit")?.addEventListener("click", () => ctx?.enterEditMode());
        return el;
      },
    },
  ],
};
```

### Widget definition fields

| Field | Values | Effect |
|---|---|---|
| `display` | `"block"` \| `"inline"` | `"block"` replaces the range with a block decoration; `"inline"` keeps surrounding text on the same line. Defaults to block. |
| `eventPolicy` | `"editor"` \| `"widget"` | `"widget"` lets the widget own DOM events inside its body (CodeMirror `ignoreEvent()`); `"editor"` lets CodeMirror handle them. Defaults to editor. |

`display: "block"` is only valid for node ranges that span whole lines. Inline or partial-line node types **must** use `display: "inline"` — a block replacement decoration over a non-line-aligned range is invalid in CodeMirror.

### Render context (`ctx`)

| Member | Description |
|---|---|
| `ctx.range` | `{ from, to, source }` — the widget's source-range offsets and the Markdown substring for that range. |
| `ctx.enterEditMode(position?)` | Move the selection into the source range (`"start"` default, or `"end"`), focus the editor, and reveal the raw Markdown for editing. Replaces the manual `ctx.setSelection(ctx.from)` + `ctx.focus()` pattern. |

### Legacy-compatible aliases

`block` and `ignoreEvents` are still supported as legacy aliases — existing widgets keep working without changes:

- `block: false` ≡ `display: "inline"` (and the default `block: true` ≡ `display: "block"`)
- `ignoreEvents: true` ≡ `eventPolicy: "widget"`

When both a canonical field and its legacy alias are set, the canonical field wins. The legacy context members `ctx.from`, `ctx.to`, `ctx.setSelection`, and `ctx.focus` also remain available.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
