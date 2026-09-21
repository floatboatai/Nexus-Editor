# Change: Add Opt-In Drag-To-Reorder for Slash Menu Commands

## Why

Roadmap item 16 introduced opt-in *automatic* slash command ordering by recency (`add-slash-recent-command-history`). That covers the common case, but users who care about a stable personal layout have no way to express it: the menu is always either registration order or recency order, and there is no affordance to say "I want `Heading 2` above `Heading 1`".

A slash menu is a high-frequency surface, and its order is the difference between one keystroke and five. Obsidian-style hosts already treat command ordering as a user preference. Today a host can only pre-sort the `slashCommands` array it registers, which is a build-time decision — it cannot be changed at runtime, cannot be persisted per user, and cannot coexist with recency ordering.

This change adds the missing runtime affordance: a drag handle on each item that lets the user reorder commands directly in the menu, with an opt-in, host-injected persistence channel that mirrors the existing history storage contract.

## What Changes

- Add an opt-in `reorderable` option to `SlashMenuUIOptions`. Accepted values: `true` for session-only reordering, or `{ storage?, storageKey? }` for host-injected persistence. Omitting it or passing `false` keeps the feature fully disabled.
- Render a grip handle (`.{prefix}-menu__handle`) as the first child of every slash menu item when the feature is enabled.
- Implement reordering with a custom `mousedown` / `mousemove` / `mouseup` drag. HTML5 drag-and-drop (`draggable="true"`, `dragstart` / `dragover`) MUST NOT be used.
- Apply the manual order to empty-query menus only, composed *after* recency ordering: commands the user has pinned win, and commands the user has never pinned keep whatever order the history layer produced.
- Clamp drag movement to the visible list boundaries. The command list MUST NOT change length, gain duplicates, or lose entries as a result of a drag.
- Keep `highlight`, the rendered order, `visibleCommands`, and confirmation aligned: after a drop, `Enter` MUST confirm the command that is rendered as active.
- Treat a handle press that does not move as inert: it MUST NOT confirm the command and MUST NOT change the order.
- Cancel an in-flight drag (without persisting) when the menu closes, is dismissed, or is destroyed.
- Persist only on drop, through a host-injected localStorage-like object. `plugin-slash` MUST NOT write to global `localStorage` by default.
- Merge persisted order with the visible window: because the editor caps slash menu results at `slashMenuLimit` (default 8) *before* the menu renders, a drop rewrites only the ids it can see and preserves the relative order of every previously stored id outside that window. A drag MUST NOT drop commands it cannot see.
- Ignore unknown, stale, or duplicated command ids in storage without breaking menu open, render, navigation, or confirmation.
- Keep disabled/default behavior fully backward compatible: registration/recency order, keyboard navigation, Enter confirm, click confirm, and the existing `history` option are unchanged.
- Enable the option in `apps/electron-demo` so the demo keeps doing its job of demonstrating engine capabilities. The library default stays off; the demo opts in explicitly.

## Non-Goals

- No keyboard-operable reordering (e.g. `Alt+ArrowUp`). The handle is a pointer affordance and is marked `aria-hidden`, so no inaccessible control is exposed. A keyboard path is a deliberate follow-up, not part of this change.
- No touch-specific long-press gesture. The drag is driven by mouse button events, matching the repository's existing custom-drag convention.
- No drag *between* the visible window and the capped-out remainder (the UI cannot observe commands beyond `slashMenuLimit`).
- No changes to slash command ranking, filtering, or the `slashMenuLimit` cap.
- No cross-command ordering for non-visible commands, and no drag on non-empty queries.
- No changes to `packages/core/**` or `packages/plugin-search/**`.
- No change to the library default: the demo opts in, the package does not.
- No new dependencies.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-slash/src/menu-ui.ts`
  - `packages/plugin-slash/src/command-order.ts` (new module, mirrors `command-history.ts`)
  - `packages/plugin-slash/src/index.ts` for the public type/export surface
  - `packages/plugin-slash/test/menu-ui.test.ts`
  - `apps/electron-demo/src/renderer/editor-shell.ts` (opt in)
  - `apps/electron-demo/src/renderer/style.css` (host styling for the handle)
- Explicitly out of scope:
  - `packages/core/**`
  - `packages/plugin-search/**`
