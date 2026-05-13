# Change: Add Snapshot History to Electron Demo

## Why

The electron demo currently supports only immediate undo/redo and normal file save flows. Users cannot inspect older document states, restore a known-good revision, or reuse a previous draft as the starting point for a new edit. This is especially limiting for note-taking and AI-assisted writing workflows, where users often want lightweight checkpoints without introducing full collaboration or Git-style versioning.

The roadmap already includes `#19 Version history / snapshots | core + host storage | P2 | planned`, with a note that the electron demo should land the reference implementation first. This change proposes that reference implementation with a deliberately narrow scope: local snapshot history for the demo app, with no changes to cloud sync, collaboration, or prompt orchestration.

## What Changes

- Add a **Snapshot History** capability to `apps/electron-demo` for the currently active document.
- Allow users to create **manual snapshots** from the UI.
- Persist recent snapshots in host-managed storage under Electron `userData`, keyed by document identity.
- Provide a renderer-side history panel that lets users:
  - inspect recent snapshots,
  - restore a snapshot into the editor,
  - reuse a snapshot as a new unsaved draft.
- Add dirty-state safeguards before destructive restore actions.
- Keep the implementation **host-side only** for v1: `@floatboat/nexus-core` remains document-centric and storage-agnostic.

## Impact

- Affected specs: `snapshot-history` (new capability)
- Affected code:
  - `apps/electron-demo/electron/main.ts` (snapshot persistence + IPC)
  - `apps/electron-demo/electron/preload.ts` (bridge)
  - `apps/electron-demo/src/renderer/bridge.d.ts` (types)
  - `apps/electron-demo/src/renderer/state.ts` (snapshot UI state)
  - `apps/electron-demo/src/renderer/app.ts` (toolbar + panel wiring)
  - `apps/electron-demo/src/renderer/history-panel.ts` (new)
  - `apps/electron-demo/src/renderer/style.css` (panel styles)
  - tests for main-process storage and renderer panel behavior
- No new runtime dependencies required; snapshots are stored as JSON in Electron `userData`.
- Back-compat:
  - normal Open / Save / Save As flows remain unchanged,
  - undo/redo remains unchanged,
  - no changes to public `@floatboat/nexus-core` APIs in this proposal.

## Notes

- This proposal intentionally covers **document snapshots**, not AI prompt history. Prompt history can later build on the same persistence and UI patterns, but is out of scope for a two-day reference PR.
- This proposal is a natural first slice of roadmap item `#19 Version history / snapshots`.
