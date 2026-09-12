# Nexus Selection Toolbar

A standalone selection-driven toolbar for Nexus editors. This package owns selection gestures, eligibility, floating positioning, button rendering, focus, and lifecycle cleanup. It does not depend on the global-toolbar or formatting packages.

## Direct actions

Configure actions explicitly. The following host chooses the shared inline-code operation:

```ts
import { createSelectionToolbarUI } from "@floatboat/nexus-plugin-selection-toolbar";
import { toggleInlineCode } from "@floatboat/nexus-plugin-formatting";

const toolbar = createSelectionToolbarUI(editor, {
  editorRoot: container,
  groups: [{ buttons: [{
    id: "inline-code",
    title: "Inline code",
    icon() {
      const icon = container.ownerDocument.createElement("span");
      icon.textContent = "<>";
      icon.setAttribute("aria-hidden", "true");
      return icon;
    },
    action: toggleInlineCode,
  }] }],
  focusShortcut: true, // Optional Alt+F10; defaults to false.
});
await toolbar.ready;

// Before replacing the source document:
toolbar.dismiss();
editor.setDocument(nextDocument, { silent: true });

// Before disposing the editor:
toolbar.destroy();
editor.destroy();
```

`SelectionToolbarUIOptions` requires `editorRoot` and `groups`. `SelectionToolbarGroup` and `SelectionToolbarButton` describe presentation and direct callbacks. Order is explicit; `groups: []` keeps the UI hidden. Actions may come from any provider, including application-specific functions that do not perform formatting. The demo chooses link, inline code, and text color in that order; the package has no built-in formatting action.

Buttons receive `(editor, signal, anchor)`. The optional `onAction(button, editor, signal, anchor)` replaces direct execution without calling both paths. The anchor is the actual source button, so hosts can mount a picker in its toolbar subtree without looking up another editor. Async callbacks can observe the AbortSignal to close pending UI and cancel work. A dismissed or replaced session cannot reopen the overlay through an old completion, and duplicate activation is blocked while an action is pending.

Async formatting transactions that should preserve the session use `userEvent: "input.format"`, as the shared inline-formatting operations do. Unrelated edits invalidate a pending session. Hosts remain responsible for cancelling their external work and dismissing before a document switch. A non-cancelled action failure emits a bubbling `nexus-toolbar-error` CustomEvent with the error in `detail`.

## Runtime commands

Enable `SelectionToolbarLifecyclePlugin` using `selectionToolbarLifecyclePluginManifest` and host-supplied command groups:

```ts
new SelectionToolbarLifecyclePlugin(app, manifest, {
  groups: [{ buttons: [{
    id: "inline-code",
    title: "Inline code",
    icon: inlineCodeIcon,
    commandId: "formatting:inline-code",
  }] }],
  focusShortcut: true,
});
```

`SelectionToolbarCommandGroup` and `SelectionToolbarCommandButton` carry command IDs instead of direct callbacks. The runtime binds them to the existing `CommandService`, passing the exact source `EditorContext` and an invocation cancellation signal. It registers no formatting commands and never falls back to a recent editor. Enable the chosen command provider before the UI; an unavailable command returns the command service's normal failure.

Runtime `groups` can also contain direct `SelectionToolbarGroup` actions, such as the demo-owned color picker. These receive the same source editor, abort signal, and anchor as standalone UI actions.

The runtime owns one managed UI per attached editor, dismisses on context changes, and cleans up on detach or unload. Empty or omitted command groups mount no UI. Disabling the global toolbar does not affect this plugin, and unloading this plugin does not remove provider commands or other UI.

## Selection behavior

The toolbar opens after a completed desktop mouse or keyboard selection in source or live-preview mode. It supports one non-whitespace range, including reversed, multiline, and soft-wrapped selections. It remains hidden during a selection gesture, composition, touch interaction, and in read-only editors. Multiple ranges, tables, block code, images, and other unsupported interactive widgets are excluded. Existing inline-code text remains eligible.

The demo link action inserts a Markdown link and selects its destination. The text-color action opens an eight-color picker with arrow-key navigation; Escape cancels the picker, and outside interaction or a document change closes it. Color formatting uses the same span markup and decorations as the global toolbar.

Actions use the command's final selection. The demo's inline-code action can therefore be clicked repeatedly to wrap and unwrap the same text while keeping the toolbar visible.

Escape, outside interaction, document edits, and external focus loss dismiss the session. Escape preserves selected text. Scrolling and layout updates reposition an active session but do not reopen an explicitly dismissed one. The overlay uses editor theme variables, flips and clamps to visible bounds, and mounts inside the containing fullscreen element when necessary. Arbitrarily transformed containers and Shadow DOM mounting are outside the initial contract.

## Keyboard and cleanup

Automatic display preserves editor focus. Call `toolbar.focus()` to deliberately enter the visible toolbar, or enable Alt+F10 with `focusShortcut`. ArrowLeft/ArrowRight navigate buttons, Enter/Space activate, and Escape dismisses and restores editor focus. Hidden toolbars do not consume keys.

`element` is the owned DOM root. `ready` resolves after editor observation and keyboard contributions are installed. `dismiss()` invalidates the active session and aborts pending invocation. `destroy()` removes UI/listeners, cancels measurements, and requests contribution disposal; it is safe before `ready` resolves and safe to repeat.

## Validation

From the repository root:

```sh
pnpm exec vitest run packages/plugin-selection-toolbar/test packages/reference-plugins/test
pnpm build
node apps/electron-demo/scripts/selection-toolbar-smoke-run.mjs
```

The native smoke test exercises real Electron input and layout, source/live-preview selection, fullscreen and zoom, Chromium composition, independent toolbar flags, shared formatting shortcuts, and existing editor interactions. It prints a system temporary directory containing its bundles and screenshots; it writes no artifacts into the repository. Operating-system IME candidate windows require manual validation.

Validation passed: 1066 tests across 70 files, 89 native Electron checks, workspace type checks, workspace/demo builds, public API checks, and strict OpenSpec validation. On Node 26, run the full suite with `NODE_OPTIONS=--no-experimental-webstorage pnpm test` so jsdom provides `localStorage`.
