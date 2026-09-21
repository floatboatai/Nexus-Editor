# Implementation Tasks

## 1. Phase 1 - OpenSpec and Red Tests

- [x] 1.1 Create `openspec/changes/add-slash-menu-reorder/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-slash-menu-reorder/specs/plugins/spec.md`.
- [x] 1.3 Add failing `plugin-slash` tests for opt-in drag reordering.
- [x] 1.4 Run the targeted `plugin-slash` menu UI test and confirm failures are limited to the unimplemented reordering behavior.

## 2. Phase 2 - Order Storage Module

- [x] 2.1 Add `packages/plugin-slash/src/command-order.ts` mirroring the `command-history.ts` storage contract.
- [x] 2.2 Support `true` for session-only ordering and `{ storage, storageKey }` for host-injected persistence.
- [x] 2.3 Apply the stored order after the recency layer so pinned commands win.
- [x] 2.4 Merge on write: rewrite the visible ids and preserve stored ids outside the visible window in their previous relative order.
- [x] 2.5 Ignore duplicate and non-string ids, invalid JSON, and throwing `getItem` / `setItem`.

## 3. Phase 3 - Menu UI

- [x] 3.1 Add an opt-in `reorderable` option without changing default behavior.
- [x] 3.2 Render a `.{prefix}-menu__handle` grip on every item when enabled, sized inline so it is grabbable without host CSS.
- [x] 3.3 Implement reordering with custom `mousedown` / `mousemove` / `mouseup`; do not use the HTML5 drag-and-drop API.
- [x] 3.4 Gate the gesture on an open menu, an empty query, and at least two rendered rows.
- [x] 3.5 Clamp movement to the rendered bounds in `moveVisibleCommand` so the list keeps its length and members.
- [x] 3.6 Keep `itemEls`, `visibleCommands`, the DOM, and the highlight index in lockstep across a move.
- [x] 3.7 Resolve item indices at event time instead of capturing them at creation, so hover and click stay correct after a reorder.
- [x] 3.8 Keep a press that never crosses the movement threshold inert: no reorder, no confirmation.
- [x] 3.9 Suppress navigation keys during a drag and cancel on `Escape`, hide, dismiss, and destroy.
- [x] 3.10 Freeze rendering while a drag is in flight; cancel the gesture when incoming state no longer matches the rendered list.
- [x] 3.11 Expose the new public types and `DEFAULT_SLASH_COMMAND_ORDER_KEY` from `packages/plugin-slash/src/index.ts`.
- [x] 3.12 Keep `packages/core/**` and `packages/plugin-search/**` unchanged.
- [x] 3.13 Enable the option in the Electron demo and style the handle there, without changing the library default.

## 4. Phase 4 - Reorder Animation

- [x] 4.1 Slide rows that changed slot into place with FLIP instead of letting them jump.
- [x] 4.2 Follow the pointer with the held row rather than sliding it into a slot.
- [x] 4.3 Skip the slide when the user prefers reduced motion.
- [x] 4.4 Clear every inline style the gesture applies when it ends, so hosts keep control of the look.
- [x] 4.5 Measure drop candidates with the held row's transform cleared: `getBoundingClientRect` reports the transformed box, so the pointer offset otherwise skewed the row's own midpoint and resolved the target one slot late.

## 5. Phase 5 - Verification

- [x] 4.1 Run the targeted `plugin-slash` menu UI tests and confirm the new red tests pass.
- [x] 4.2 Run `pnpm test` (68 files, 928 tests) and confirm no regressions.
- [x] 4.3 Run `pnpm typecheck` and `pnpm check:api`.
- [x] 4.4 Verify the gesture against real browser layout in the Electron demo with the option temporarily enabled and reverted afterwards: handle hit area, live reorder, drop commit, highlight follow-through, and `Enter` confirming the dropped command.
