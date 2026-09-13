# @floatboat/nexus-plugin-block-drag

Move one complete Markdown block at a time using a hover handle. Works in Nexus live preview and source mode, in desktop browsers and Electron. The Electron demo enables it by default; library consumers opt in.

## Static integration

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createBlockDragPlugin } from "@floatboat/nexus-plugin-block-drag";

const editor = createEditor({
  container: document.querySelector<HTMLElement>("#editor")!,
  initialValue: "First paragraph\n\nSecond paragraph",
  livePreview: true,
  plugins: [createHistoryPlugin(), createBlockDragPlugin()],
});
```

React and Vue hosts pass the same plugin through their `plugins` option. Include the history plugin when users need undo/redo; block dragging does not install a second history owner.

## Dynamic integration

For a core editor without the plugin runtime:

```ts
import { createBlockDragExtension } from "@floatboat/nexus-plugin-block-drag";

const registration = editor.getContributionSink().registerExtension(
  "block-drag",
  createBlockDragExtension({
    label: "拖动以移动",
    movedAnnouncement: "已移动块",
    unavailableAnnouncement: "无法移动到此位置",
  }),
);
await registration.ready;
// Disabling preserves the document, editor instance, selection and history.
await registration.dispose();
```

Hosts using the native plugin runtime register `blockDragLifecyclePluginManifest` with `BlockDragLifecyclePlugin`, then enable/disable its `block-drag` owner through their PluginManager. It requires only `nexus.editor-host`; no file-system or Workspace access is needed. Existing and future editors get independent gesture state. Use either the static or runtime owner for an editor, not both.

The Electron boot flag is `blockDrag` in `ReferencePluginFeatureFlags`. The app defaults it to `true`; set it to `false` when booting to leave it out. This release does not add a plugin settings screen.

## Behavior

- Hover the content or focus the editor to reveal a handle in the leading margin. Drag beyond a small movement threshold; the source background and insertion line show exactly what will move and where. Hovering the handle changes its background without an outline; keyboard focus retains a visible focus ring.
- Mouse and trackpad dragging move one outermost paragraph, heading, list, blockquote, code block, table or horizontal rule. Lists include all items and nested lists; blockquotes include their nested content. Images move with their containing paragraph.
- A heading moves only itself, not its section. Folded headings have no handle. Unsupported blocks, such as HTML and reference definitions, cannot be dragged but remain intact when other blocks move.
- `Alt+Shift+ArrowUp/ArrowDown` moves the block containing the editor cursor. A focused handle also supports `ArrowUp/ArrowDown`; `Escape` returns focus to the editor. Widget-internal editing keeps its own keyboard behavior.
- Dragging near the editor's top/bottom edge scrolls it. Dropping stays within the original editor. Clicks, original-position drops and invalid drops do not change the document.
- `Escape`, pointer cancellation, window blur, document changes during a drag, editor destruction and runtime unload cancel the gesture. No document edits are made before a valid drop.
- Moves pass through the existing transaction filters and form isolated undo steps. Selections inside moved content follow it. A table's pending cell edits commit before the drag starts, so undoing its move preserves the preceding cell edit.
- The plugin uses the editor's existing Markdown syntax and normalized text coordinates. It preserves block text rather than serializing the AST; only affected separators may change. CRLF input follows the core editor's existing newline normalization.
- If relocating a block would merge/reinterpret other blocks (for example, removing the paragraph separating two lists), that drop is unavailable. No hidden HTML markers or extra visible separators are inserted to force it.
- The handle reserves 28px at the content's leading edge and uses the existing `--nexus-*` theme variables. It is independent of table row/column grips.

Multi-block selection, touch dragging, nesting changes, cross-document movement, section movement and click-to-open block menus are outside this release.

## Local verification

From the repository root, start the browser fixture with the demo's installed Vite:

```sh
apps/electron-demo/node_modules/.bin/vite --config vitest.config.ts --host 127.0.0.1 --port 5178
```

Open `http://127.0.0.1:5178/packages/plugin-block-drag/test/browser.html`. The fixture exposes live/source mode, enable/disable, read-only mode, long documents, list-boundary cases, undo/redo and the resulting Markdown. It edits temporary in-memory documents only.

Automated tests cover Markdown preservation, cursor mapping, atomic submission, cancellation, filtering, history isolation, read-only/composition, folded headings and dynamic lifecycle. Real geometry and scrolling are checked in the browser fixture.
