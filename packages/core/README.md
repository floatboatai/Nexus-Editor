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

## Host-owned document authority

`editor.getContributionSink()` exposes `registerAuthoritativeSource(ownerId, history)` for a Host that already has a committed document authority, such as a collaboration Replica. It is not a network, authentication, or persistence API. The returned `EditorAuthoritativeSourceRegistration` extends `EditorContributionRegistration` with `dispatch(transaction)` and `dispatchTransactions(transactions)`.

```ts
import type { EditorAPI, EditorHistoryController } from "@floatboat/nexus-core";

async function attachDocumentAuthority(editor: EditorAPI, history: EditorHistoryController) {
  const source = editor.getContributionSink().registerAuthoritativeSource(
    "host-document-authority",
    history,
  );
  await source.ready;

  const result = source.dispatch({
    changes: [{ from: 0, to: editor.getDocument().length, insert: "# Committed document\n" }],
    origin: ["host-document-authority"],
  });
  if (result.status !== "success") {
    await source.dispose();
    throw new Error("The Editor could not project the committed document");
  }
  return source;
}
```

The Host must supply `history.undo()` and `history.redo()` returning whether its authority changed; a successful history action must also project that committed change back to the Editor. Do not implement them by calling `editor.undo()`/`redo()`, which route back to the controller while the source is active.

- `ownerId` must not be blank. Exactly one source may be active per Editor, including for the same owner; a competing registration throws without replacing the existing source. Registration on a destroyed Editor also throws.
- `ready` resolves when installed (currently synchronously installed with an already-resolved promise); it does not mean network synchronization or durable storage is ready. The Host decides when to attach and when a document is usable.
- Normal typing and `editor.dispatchTransaction(s)` remain Local Proposals subject to transaction filters. Dispatch through the source is an Authoritative Update: it bypasses local filters, is excluded from CodeMirror history, and reports `authority: "authoritative"` and `sourceOwnerId` to committed-update listeners.
- `dispatchTransactions` uses sequential coordinates: each entry addresses the document produced by the previous one. The complete batch is validated before one commit and one committed-update notification, not one notification per entry. The result is a `success`, `rejected`, or `recursion-limit` union; handle failure rather than assuming the Editor accepted an external state.
- While active, `editor.undo()`/`redo()`, the built-in history keys, and history `beforeinput` events use the supplied controller without falling back to local history. Activating external authority uses the table source fallback so independent content-editable table state cannot silently become a competing authority.
- `dispose()` is idempotent and returns a promise. It releases exclusive ownership and external-document mode without reverting Markdown or closing the Host's document, Provider, or Store. Future dispatch through that registration is rejected with `source-disposed`. Editor destruction instead invalidates it with `editor-destroyed`; another source may attach only to a live Editor after the old registration is released.

These semantics are exported as `EditorHistoryController`, `EditorTransactionAuthority`, and `EditorAuthoritativeSourceRegistration`. `CoreEditorTransactionContext.authority` also distinguishes ordinary `"proposal"` updates. Hosts should not echo their own authoritative projections back into the same authority.

## Owner-scoped destruction listeners

`editor.getContributionSink().registerDestroyListener(ownerId, listener)` returns an `EditorContributionRegistration`. `EditorDestroyListener` is `() => void | Promise<void>` and `EditorLifecycleContributionSink` describes this surface. Multiple listeners, including listeners sharing an owner ID, are allowed; registration requires a nonblank owner and fails after destruction.

Each registration has `id`, `ownerId`, `ready`, `disposed`, and idempotent `dispose()`. Await `ready` for installation. Disposing a registration before destruction removes that listener without invoking it. On `editor.destroy()`, remaining registrations are marked disposed and their listeners are invoked once, in registration order, before the transaction pipeline and view are torn down. The Editor is already marked destroyed at that point, so a listener must not dispatch or attach another source.

`editor.destroy()` returns `void`: it **does not await asynchronous listeners**. Synchronous exceptions and promise rejections are caught and logged without preventing other listeners. A listener is suitable for initiating detach/cancellation, not for certifying that a database flush, network close, or file write finished. The Host must explicitly await its own document/Engine cleanup and persistence operations when it needs durable shutdown, preferably before destroying the Editor. Do not include credentials or document content in errors that a listener throws.

## Other config highlights

See the `EditorConfig` type for the full surface: `livePreview`, `plugins`, `theme` / `setTheme`, `locale`, `readOnly`, `tabSize`, `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`, `onChange` / `onFocus` / `onBlur` / `onAssetUpload`.
