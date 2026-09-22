# Change: Add Selection-Triggered Inline Formatting Toolbar

## Why

Issue #327 asks for a floating toolbar that appears when the user selects text inside the editor — the same affordance Notion / Google Docs / Medium offer for inline formatting. The existing `plugin-toolbar` ships a persistent top toolbar; selecting text gives no formatting affordance, forcing users to scroll back to the top of a long document to toggle bold/italic/etc.

This change adds an orthogonal inline floating toolbar to `plugin-toolbar` that mirrors the slash-menu UI lifecycle (selection-triggered, viewport-flipping, IME-aware, dismiss-on-outside-click) and reuses the existing `ToolbarButton` / `ToolbarGroup` types and `toolbar-commands` actions so hosts can compose their own button sets with zero new dependencies.

## What Changes

- Add `createInlineToolbarUI(editor, options)` to `plugin-toolbar`. Returns `{ element, show, hide, destroy }`.
- Show the toolbar when the editor reports a non-empty selection (`getSelectedText() !== ""`); hide when the selection collapses.
- Position centered above the selection using `editor.getCoordsAtPos()`, flipping below when the viewport has no room above, and clamping inside the right edge.
- Default button set covers inline-only formatting — bold, italic, strikethrough, inline code, insert link — so the inline toolbar never offers block-level commands that don't make sense on a selection.
- Hosts may pass custom `groups` (reusing `ToolbarGroup` / `ToolbarButton`), a custom mount `container`, a `classPrefix` for styling hooks, and a vertical `offset`.
- Full lifecycle parity with `createSlashMenuUI`: `destroy()` detaches all DOM listeners and the element; safe to call multiple times. IME composition suppresses show; `compositionend` re-evaluates. Escape and outside-mousedown dismiss; re-selecting resets the latch. Editor blur dismisses. Window resize and scroll re-position.
- Export `createInlineToolbarUI`, `InlineToolbarUI`, `InlineToolbarUIOptions` from the package entry, and re-export `ToolbarButton` / `ToolbarGroup` for hosts that build custom groups.

## Non-Goals

- No new package — the inline toolbar lives inside `plugin-toolbar` next to the existing top toolbar.
- No new runtime dependencies.
- No changes to the persistent top toolbar (`createToolbarUI`) or its default groups.
- No core API additions — the implementation uses only the existing `selectionChange` event, `getCoordsAtPos`, `getSelectedText`, `getSelection`, `isComposing`, `focus`, `blur`, `on` / `off` surface.
- No styling / CSS file — visual theming stays host-driven via the `classPrefix` and the CSS custom properties already used by the top toolbar.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-toolbar/src/inline-toolbar.ts` (new)
  - `packages/plugin-toolbar/src/index.ts` (export the new API)
  - `packages/plugin-toolbar/test/inline-toolbar.test.ts` (new)
