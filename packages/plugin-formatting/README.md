# Nexus Formatting

Shared Markdown formatting for Nexus editors. This package owns document transformations, legacy editor contributions, runtime format commands, default format shortcuts, and color decorations. It mounts no toolbar UI.

## Direct use

```ts
import { createFormattingPlugin, toggleInlineCode, applyTextColor } from "@floatboat/nexus-plugin-formatting";

const editor = createEditor({
  container,
  plugins: [createFormattingPlugin()],
});

editor.setSelection(6, 11);
toggleInlineCode(editor);
applyTextColor(editor, "#0969da");
```

The legacy factory installs the existing shortcuts, slash catalogue, and color-decoration extension. Install it once per editor. Direct operations accept `EditorAPI`; they do not depend on a mounted toolbar.

Exports include `toggleBold`, `toggleItalic`, `toggleStrikethrough`, `toggleInlineCode`, `toggleWrap`, `toggleHeading`, `insertLink`, list/blockquote toggles, image/code-block/divider insertion, `applyTextColor`, and `applyHighlight`. Parameterized operations keep their typed function arguments. Their existing formatting and final-selection behavior is preserved.

## Runtime use

Enable `FormattingLifecyclePlugin` with `formattingLifecyclePluginManifest` before UI consumers. It registers `formatting:*` commands with the existing `CommandService`; no additional action service or registry is needed.

```ts
const commands = app.capabilities.require(COMMANDS_CAPABILITY);
await commands.executeCommand("formatting:inline-code", {
  trigger: "ui",
  editor: sourceEditorContext,
});
```

`formattingCommands` exposes command metadata and implementations. `createFormattingRuntimeSlashContribution()` provides a static catalogue that points at canonical runtime command IDs and registers no duplicate commands or editor extensions.

Global toolbar, selection toolbar, slash menu, and shortcuts can consume the provider independently. Unloading a toolbar UI does not unload formatting. Hosts are responsible for enabling the provider before its consumers and for deciding when it should be disabled.

## Compatibility

Existing formatting functions imported from `@floatboat/nexus-plugin-toolbar` remain re-exports of these implementations. The old `createToolbarPlugin()` factory remains available for legacy hosts; use either it or `createFormattingPlugin()` in an editor, not both.

Runtime global-toolbar hosts now enable the formatting provider separately. `ToolbarLifecyclePlugin` preserves `toolbar:*` format command entrypoints as forwarding registrations. They set `showInCommandPalette: false` to remain explicitly callable without duplicate command-palette entries; canonical IDs are `formatting:*`. Other commands remain visible by default. Undo and redo retain their existing editor-operation entrypoints. `mountUi: false` keeps these compatibility registrations without mounting global UI, and `createToolbarRuntimeSlashContribution()` remains available for hosts using the old IDs.

When `HotkeyService` is available, provider activation migrates non-default preferences from old `toolbar:*` format IDs to canonical IDs. An existing non-default canonical preference takes precedence. The old preference is then reset to its empty default binding set, preventing duplicate shortcuts. Cleared bindings remain cleared, and later user changes to canonical defaults survive reloads. Hosts without HotkeyService manage their own preference migration.

## Cancellation

`CommandContext.signal` optionally carries an `AbortSignal`. The command service checks it after context resolution and before invocation. It also rejects registrations removed while resolution was pending. A callback that starts asynchronous external work must observe the signal itself; cancellation does not undo effects that already occurred.
