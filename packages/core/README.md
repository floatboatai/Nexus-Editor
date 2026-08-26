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

### Keybindings API

Declare bindings up front, or register them at runtime through the contribution sink:

```ts
const editor = createEditor({
  container,
  keybindings: [{ key: "Mod-e", run: () => true }], // owner: "editor-config"
});

const registration = editor.getContributionSink().registerKeybinding(
  "my-host",
  { key: "Mod-k", run: (api) => true },
  { priority: 5 },
);
await registration.ready;
await registration.dispose(); // idempotent

editor.getKeybindings(); // every effective binding, ordered by resolution precedence
```

Semantics:

- **Precedence** — positive-priority host bindings install above plugin shortcut / command-hotkey keymaps but below built-in Markdown handling; zero or negative priority lands below every static keymap. Ties resolve by registration order.
- **Duplicates allowed** — two owners may bind the same key; the higher-precedence handler runs first, and a falsy return falls through to the next one.
- **Snapshot** — `getKeybindings()` returns plain-data entries (`key`, `source`, `ownerId`) ordered builtin → host(positive) → plugin-shortcut → plugin-command → host(non-positive), i.e. the array index *is* the resolution order. Use it to build conflict-detection UI for custom-shortcut settings.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `keybindings`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
