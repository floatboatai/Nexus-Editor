# Change: Add Opt-In Slash Recent Command Ordering

## Why

Roadmap item 16 covers command and search history across separate packages. PR 71 delivered the independent first-stage `plugin-search` search query history work; this change is the `plugin-slash` follow-up and intentionally stays independent from that implementation.

Slash menus should not restore prior `/query` text. For `plugin-slash`, the useful history behavior is to remember commands the user actually confirmed and, when explicitly enabled, show recently used commands earlier the next time the slash menu opens.

## What Changes

- Add an opt-in recently-used command ordering mode to `plugin-slash`.
- Enable history with a minimal `history: true` flag or a `history: { storage, storageKey, maxEntries }` options object; omitting history or passing `false` keeps it disabled.
- Record confirmed slash command ids, dedupe repeated ids to the front, and cap the stored list with `maxEntries`.
- Reorder empty-query slash menu results by recent command usage when history is enabled.
- Support session-only history when enabled without storage.
- Support optional host-injected localStorage-like storage for persistence.
- Ignore invalid stored JSON, storage read/write failures, and stale or unknown command ids without breaking the menu.
- Keep disabled/default behavior fully backward compatible: registration order, keyboard navigation, Enter confirm, and click confirm remain unchanged.

## Non-Goals

- No slash query history and no `/query` input recall.
- No core-level slash ranking refactor.
- No `plugin-search` changes; PR 71 remains independent.
- No electron demo changes.
- No global `localStorage` writes by default.
- No new dependencies.

## Impact

- Affected specs: `plugins`
- Affected code expected in a future implementation phase:
  - `packages/plugin-slash/src/menu-ui.ts`
  - `packages/plugin-slash/src/index.ts` only for public type/export surface if needed
  - `packages/plugin-slash/test/menu-ui.test.ts`
- Explicitly out of scope:
  - `packages/plugin-search/**`
  - `apps/electron-demo/**`
  - `packages/core/**`
