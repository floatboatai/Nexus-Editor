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

## Document snapshots

`await editor.captureDocumentSnapshot(options?)` returns an `EditorDocumentSnapshot` for host-managed saving, draft backups, or export. Its `markdown` includes pending table-cell edits that have not yet been committed to the CodeMirror document.

| Option | Behavior |
|---|---|
| `signal?: AbortSignal` | Cancels a pending capture. Aborting the signal or destroying the editor rejects with a `DOMException` named `AbortError`. |
| `includeRenderAst?: boolean` | Defaults to `false`. When `true`, also returns an optional `renderAst: Root` (from `mdast`), parsed separately from the captured Markdown using the editor's remark plugins and installed Markdown transforms. |

The capture waits for active IME composition (including table cells) and table selection/drag gestures to finish. It does not force input to end and has no built-in timeout; the host can cancel through `signal`. AST parsing and transforms run synchronously after input settles, so leave `includeRenderAst` off for source-only draft backups.

Unlike synchronous `getDocument()`, which reads the current CodeMirror document directly, the snapshot overlays pending table source onto a string copy. Capturing does not dispatch an edit, consume the table's pending changes, change focus or selection, or add an undo step. It does not save a file or generate HTML.

The rendering pipeline uses remark rather than a custom `config.parser`, matching `exportHTML()` parsing semantics. Its AST is not a copy of `getAst()` and can differ from the custom parser's output. After all transforms run, `structuredClone` detaches the result, including shared nodes returned by plugins. The caller may modify the returned AST without changing plugin-owned data, the editor's cached AST, or another snapshot. Plugin AST data must be structured-cloneable; unsupported values such as functions cause capture to reject with `DataCloneError`, without a shallow-copy fallback.

```ts
async function captureForExport(signal: AbortSignal) {
  try {
    return await editor.captureDocumentSnapshot({
      signal,
      includeRenderAst: true,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}
```

Capture can also reject if a pending table range no longer matches its document or a rendering transform fails. Handle those failures rather than saving an empty or partial document. The option and result types are exported as `CaptureDocumentSnapshotOptions` and `EditorDocumentSnapshot`.

## Managed image input and resources

The legacy `onAssetUpload(file)` callback is unchanged. Opt into source-bound asynchronous paste/drop handling with `assetInput: { managed: true }`:

```ts
const editor = createEditor({
  container,
  assetInput: {
    managed: true,
    onEvent(event) {
      // Render progress/errors in your own UI. operationId identifies this upload.
      console.log(event.status, event.completed, event.total);
    },
  },
  onAssetUpload: (file, context) => uploadAuthorizedFile(file, context?.signal),
  livePreview: { assetProvider: authorizedResources },
});
```

`uploadAuthorizedFile` and `authorizedResources` are host implementations. The upload returns a Markdown reference; core does not choose an attachment directory or write files. In managed mode its optional `AssetUploadContext` carries the operation ID, paste/drop kind and cancellation signal. Successful files are inserted together in input order, with isolated undo history when a history extension is installed. Individual failures remain observable; the final operation is inserted, failed or cancelled.

Document bookmarks map through edits before their ranges, rather than following a later selection. Replaced ranges, `setDocument`, destruction and explicit `editor.cancelAssetInput?.(operationId)` cancel pending work. Omitting the ID cancels all managed uploads for that editor. Providers should honor the signal to stop their own I/O; late results never insert into another document. Cancelling does not remove files already created by a host uploader.

Built-in table cells capture their own source selection; changes that invalidate the captured cell cancel insertion. Third-party input targets may implement `captureSelection(point?)` returning an `EditorInputBookmark` with validity, replacement and disposal methods. An optional bookmark signal requests immediate cancellation when its target is revoked. Targets without this capability return an unsupported-target outcome, never a fallback insertion into the document selection. Plain text and existing plugin consumption keep their normal behavior.

`AssetProvider.read(reference, options)` returns authorized `AssetResource` bytes and MIME type, or null. It grants no new filesystem or network permissions. When configured for built-in Markdown images, the renderer does not assign the original reference to `src`; it creates and releases object URLs for the supplied bytes. Reloading a document also invalidates resource contexts, including when two files contain identical Markdown. Custom renderers remain responsible for their own resources; they can use the public `loadAssetImage(image, reference, provider)` helper and `releaseAssetResources(root)`.

`loadAssetImage` returns `{ ready, dispose }`. `ready` reports whether bytes were bound, unavailable, failed or cancelled; actual image decoding remains the browser's responsibility. Disposal aborts waiting and revokes only the URL owned by that handle. A browser host using CSP must allow `blob:` for images. Resource limits default to 10 MiB per image; the provider may enforce a lower limit.

## Buffer revisions and restoration

Snapshots include an opaque `revision`. `getDocumentRevision?.()` queries the current revision, including observed table input. Revisions belong to one editor lifetime and are not disk versions or persistent history IDs. `isReadOnly?.()` exposes the current editor read-only state without inspecting DOM.

```ts
const before = await editor.captureDocumentSnapshot();
if (!before.revision || !editor.restoreDocumentBuffer) throw new Error("Restoration is unsupported");
const result = await editor.restoreDocumentBuffer(historicalMarkdown, {
  expectedRevision: before.revision,
  signal,
});
// Handle conflict, read-only, history-unavailable and transaction-rejected explicitly.
```

Restoration waits for IME and active table gestures, checks the revision and preserves pending cell input as the pre-restore content. With history installed, one undo returns to that complete content. Transaction filters remain authoritative. No file, encoding, attachment or save baseline is changed, and the host remains responsible for confirmation and persistence. Cancellation rejects with `AbortError`. The additional query/restore methods are optional in `EditorAPI` for compatibility with external implementations; built-in editors implement them.

Stable `dispatchTransaction` / `dispatchTransactions` accept `history: "isolate"` to keep a command separate from adjacent undo entries. This intent survives transaction-filter replacement. It does not install undo support by itself.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
