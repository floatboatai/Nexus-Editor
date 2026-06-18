# Change: Add Search Query History

## Why

Roadmap #16 ("Command / search history") calls for persisted history across `plugin-search` and `plugin-slash`. This change delivers the first stage: opt-in search query history for `@floatboat/nexus-plugin-search`, so users can recall prior searches without changing default editor behavior.

## What Changes

- Add an opt-in search query history capability to `createSearchPlugin()`.
- Record submitted non-empty search queries after trimming whitespace.
- De-duplicate repeated queries and move the newest submission to the front.
- Respect a configurable `maxEntries` cap, dropping the oldest entries first.
- Support host-injected storage for persistence.
- Avoid implicit writes to global `localStorage`; hosts must explicitly provide persistence.
- Treat unavailable storage, thrown storage operations, and invalid JSON as recoverable.
- Add ArrowUp / ArrowDown recall inside the search input when history is enabled and entries exist.
- Preserve existing search behavior when history is disabled.

## Non-Goals

- No `plugin-slash` command history in this PR.
- No persisted recently-used slash command ordering in this PR.
- No repo-wide storage adapter or `EditorConfig` storage API in this PR.
- No Electron demo search-bar rewrite in this PR.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-search/src/index.ts`
  - `packages/plugin-search/test/plugin-search.test.ts`
- Affected roadmap: first-stage implementation for Roadmap #16 only. Slash command history remains a follow-up.
