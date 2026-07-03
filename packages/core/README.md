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

### Scroll & viewport

Primitives for hosts that render a split-view Markdown preview and need to keep it aligned with the editor's viewport (roadmap #13). The core does not ship a preview panel — it exposes the coordinates and events a host needs to build one.

```ts
// Snapshot of the current scroll state: raw pixels + the document offsets
// at the top and bottom edges of the viewport.
const { scrollTop, scrollHeight, clientHeight, topPos, bottomPos } =
  editor.getScrollInfo();

// Sugar for "what document range is on screen right now?"
const { from, to } = editor.getVisibleRange();

// Scroll a document offset into the viewport. `align` follows CM6's
// `EditorView.scrollIntoView` semantics ("nearest" is the default and only
// scrolls if the target is off-screen).
editor.scrollPosIntoView(pos, { align: "center" });

// Fires on every scroll of the editor's scroll container, coalesced to at
// most once per animation frame so preview panels don't have to debounce.
editor.on("scroll", (info) => {
  const line = editor.getDocument().slice(0, info.topPos).split("\n").length;
  previewPanel.scrollToLine(line);
});
```

Typical split-view pattern: on `scroll`, use `topPos` to find the top-line anchor and scroll the preview to the matching rendered element. When the preview scrolls the other direction, resolve the top preview element back to a source offset and call `scrollPosIntoView` — guard against re-entry with a small `syncing` flag so the two panels don't chase each other's events.

### Custom keybindings

Every plugin-declared shortcut (`NexusPlugin.shortcuts[]`) and command hotkey (`EditorCommand.hotkey`) can be enumerated and rebound at runtime — enough for a host to build an Obsidian-style hotkey settings panel without touching plugin source.

```ts
// List every active binding with source tagging.
const entries = editor.getKeybindings();
for (const e of entries) {
  console.log(e.id, "→", e.key, `(default: ${e.defaultKey})`);
}
// plugin:toolbar/command:bold → Mod-b (default: Mod-b)
// plugin:toolbar/command:italic → Mod-i (default: Mod-i)
// ...

// Rebind a command; the default key stops working, the new key dispatches.
editor.setUserKeybindings([
  { id: "plugin:toolbar/command:bold", key: "Mod-Shift-b" },
]);

// Unbind — the entry stays in `getKeybindings()` but its `key` becomes null.
editor.setUserKeybindings([
  { id: "plugin:toolbar/command:bold", key: null },
]);

// Restore all defaults.
editor.setUserKeybindings([]);

// React to changes (fires once on hydration + once per setUserKeybindings call).
editor.on("keybindingsChange", (entries) => {
  const clashing = entries.filter((e) => e.conflicts.length > 0);
  if (clashing.length) console.warn("Colliding bindings:", clashing);
});
```

**Contract notes**

- `setUserKeybindings` is **snapshot-replace**, not merge — pass every override you want active. `[]` restores every entry to `defaultKey`.
- Unknown ids in the overrides array are silently ignored (settings UIs can safely persist ids for plugins that later disappear).
- Two entries resolving to the same key after override merge get each other's id in a `conflicts` array. Dispatch still follows CodeMirror's "last-registered wins" order — the array is for surfacing warnings, not for auto-resolution.
- Built-in editor keymaps (Enter list continuation, tab indent) are **not** included in this surface yet. Only plugin-declared bindings are rebindable. See `docs/ROADMAP.md` #14.
- The core does not persist overrides. Hosts call `setUserKeybindings()` on every `createEditor()` if they want the previous session's overrides.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
