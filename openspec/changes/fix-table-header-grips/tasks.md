## 1. Specification

- [x] 1.1 Define header-owned grip behavior and compatibility boundaries.
- [x] 1.2 Record the DOM-index migration and interaction-lock constraints.

## 2. Implementation

- [x] 2.1 Replace the standalone column grip row with header-owned grip overlays.
- [x] 2.2 Update width measurement, row targeting, hover behavior, and drag cleanup to use semantic table structure.
- [x] 2.3 Audit the table-widget rules for state lifecycle, drag locking, selection cleanup, and border styling.

## 3. Verification

- [x] 3.1 Add regression tests for header ownership, column selection, drag reorder, focused-cell drag, range selection, outside deselection, and Delete behavior.
- [x] 3.2 Run typecheck, full tests, package builds, and Electron demo build.
- [ ] 3.3 Manually exercise the Electron demo's table interactions in a non-interrupted desktop session.
- [x] 3.4 Check the final diff for generated artifacts, secrets, and unrelated changes.
