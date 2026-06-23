# Implementation Tasks

## 1. Phase 1 - OpenSpec and Red Tests

- [x] 1.1 Create `openspec/changes/add-slash-recent-command-history/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-slash-recent-command-history/specs/plugins/spec.md`.
- [x] 1.3 Add failing `plugin-slash` tests for opt-in recently-used command ordering.
- [x] 1.4 Run the targeted `plugin-slash` menu UI test and confirm failures are limited to the unimplemented history behavior.

## 2. Future Implementation

- [x] 2.1 Add opt-in `plugin-slash` menu history options without changing default behavior.
- [x] 2.2 Track recently confirmed slash command ids in session memory when history is enabled.
- [x] 2.3 Read and write optional host-injected localStorage-like storage defensively.
- [x] 2.4 Reorder visible commands for empty-query menus while keeping highlight, Enter confirm, and click confirm aligned with the rendered order.
- [x] 2.5 Ignore stale or unknown command ids and enforce dedupe-to-front plus `maxEntries`.
- [x] 2.6 Keep `packages/plugin-search/**`, `apps/electron-demo/**`, and `packages/core/**` unchanged.
- [x] 2.7 Re-run the targeted `plugin-slash` tests and ensure the new red tests pass without regressing existing behavior.
