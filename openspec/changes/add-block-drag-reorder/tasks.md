# Delivery progress

## 1. Implemented capabilities

- [x] 1.1 Content reordering: identify complete blocks, validate destinations, and preserve Markdown content and selections.
- [x] 1.2 User interaction: provide dragging, destination feedback, scrolling in long documents, cancellation, and keyboard movement.
- [x] 1.3 Editing safeguards: integrate host transactions and undo, and coordinate table input, read-only state, composition, and plugin activation.
- [x] 1.4 Developer integration: provide static and runtime plugins, integrate Electron defaults and builds, and document usage.

## 2. Completed validation

- [x] 2.1 Automated validation: movement rules, content preservation, undo, and plugin lifecycle tests pass; type checks, API checks, and builds pass.
- [x] 2.2 Browser core flows: paragraph moves in live preview and source mode, whole-list and table moves, scrolling in long documents, read-only behavior, and undo after activation changes.
- [x] 2.3 Table editing continuity: newly entered text moves with its table, and undoing the move preserves the text.
- [x] 2.4 Electron basic integration: default activation and keyboard movement pass.

After integration cleanup on 2026-09-13, the full regression suite passed with 935 tests across 70 files. Type checks, API checks, package builds, and the Electron build also passed. The recorded UI checks are from 2026-09-12; subsequent styling changes still require acceptance checks. See the [plugin README](../../../packages/plugin-block-drag/README.md) for the browser validation entry point and instructions.

## 3. Remaining work before release

- [ ] 3.1 Actual dragging in Electron: manually verify mouse and trackpad moves, cancellation, and undo. Previous automation did not reliably trigger the gesture, so this remains unverified.
- [ ] 3.2 Content and display coverage: complete upward, downward, start, and end moves for headings, images, blockquotes, code, and thematic breaks in browsers and Electron, including very long blocks, zoom, and cancellation.
- [ ] 3.3 Existing editing behavior: confirm that text selection, image and file drops, code controls, real composition input, and internal table interactions remain unaffected.
- [ ] 3.4 Final visual acceptance: verify that handle hover has no outline, the source block uses only a background highlight while dragging, and keyboard focus remains clearly visible.
- [ ] 3.5 Rejected table commits: prevent movement from starting when the host rejects saving cell input; fix the reproduced review finding where the old content still moves.
- [ ] 3.6 Runtime keyboard shortcuts: integrate the host command service to support user rebinding, clearing bindings, and conflict management.
