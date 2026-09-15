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

## Embedded HTML and link safety

Markdown is treated as untrusted input. Two places hand an author-controlled string to the browser, and both are filtered:

- **Embedded HTML** — an HTML block, or a paragraph promoted to HTML because it contains inline tags, is rendered through `innerHTML`. The markup is parsed first and then inspected as a DOM tree, so script-bearing elements (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, `<base>`, `<meta>`, `<link>`, …), event handler attributes and unsafe destinations are removed. SVG animation elements (`<animate>`, `<set>`, `<animateMotion>`, …) are removed as well: they write attributes at runtime, after the check has run, so `<set attributeName="href" to="javascript:…">` could otherwise put a script URL into a link that looked clean when it was sanitised. Character references, `/` used as an attribute separator, control characters before a URL scheme and `<svg>` / `<math>` subtrees are all resolved by the parser before the check runs, which is what a source-level filter cannot see.
- **Link destinations** — a rendered link carries `data-link-url` only when its scheme is allowed; the click handler re-checks before opening, and a link inside a table cell is rendered as plain content instead of an `<a href>`.

Allowed schemes are `http`, `https`, `mailto` and `tel`. Relative references, fragments and protocol-relative URLs are always allowed. A `data:` payload is accepted only in an image slot — `img` / `source` `src` and `srcset`, `video` `poster`, SVG `image` `href`. Anything in embedded HTML that points outside the current fragment is forced into a new browsing context with an explicit `rel="noopener noreferrer"` (`<a>`, `<area>` and `<form>`, with `formtarget` dropped), so a document cannot navigate the editor or reach it through the opener; a `#fragment` destination stays same-document. Markdown links rendered by the engine already behaved this way — this makes hand-written HTML match them.

Kept on purpose: `style` attributes, form controls, `<details>` / `<summary>`, inline SVG and comments — so a document can still change its own rendering and offer interactive widgets. `autofocus` is kept for the same reason: on its own it does not run code, and only the handler attributes it is usually paired with are removed. Use the host's own sanitizer if that is too permissive:

```ts
createEditor({
  container,
  livePreview: {
    renderers: {
      html: ({ text }) => {
        const host = document.createElement("div");
        host.innerHTML = DOMPurify.sanitize(text);
        return host;
      },
    },
  },
});
```

Known boundaries, so they are not mistaken for guarantees:

- The forbidden list is a **denylist**. It covers the elements that were found to matter (including the SVG animation elements that rewrite attributes at runtime), but a host that registers **its own custom elements** will still see them instantiated from document markup — the sanitiser cannot know a host's registry, and a custom element's own `attributeChangedCallback` is outside its reach.
- `id` and `name` are kept, so **DOM clobbering** of host code that resolves elements by those attributes is out of scope.
- `style` is CSS only. It cannot execute script in a modern engine, but it can still leak a request (`background: url(…)`) or draw over the editor chrome. A host that renders untrusted notes should ship a Content Security Policy as well.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
