# Change: Add Provider-Neutral, Yjs-First Realtime Collaboration

## Why

Nexus keeps Markdown text as its source of truth, but it currently has no supported way for multiple editor instances to edit that source concurrently. Hosts can observe and dispatch transactions, yet every host must invent conflict resolution, presence, reconnection, and collaboration-aware undo behavior itself. This blocks team docs, collaborative CMS, and AI/human co-editing use cases and leaves roadmap items #18–#20 without a stable foundation.

The repository already has the right integration seam: the core transaction pipeline separates pre-commit filters from post-commit update listeners and preserves stable transaction origins. A collaboration package can therefore synchronize text incrementally without replacing the editor, reparsing a second document model, or coupling Nexus to a hosted backend.

## What Changes

- Add `@floatboat/nexus-plugin-collab`, a browser-safe Nexus plugin built around a Yjs `Y.Text` shared type.
- Keep Yjs as the synchronization model while remaining network-provider neutral:
  - the plugin accepts a host-supplied `Y.Doc` and optional Yjs awareness instance;
  - it does not import, create, connect, or own `y-websocket`, Hocuspocus, WebRTC, Electron IPC, or any hosted service;
  - hosts remain responsible for provider authentication, connection lifecycle, persistence, and server policy.
- Synchronize local and remote edits as incremental CodeMirror/Nexus transactions. Full-document `setDocument()` replacement is forbidden on the steady-state synchronization path.
- Tag remote editor transactions with a stable collaboration origin, suppress echo loops, and exclude remote edits from the local undo history.
- Provide collaboration-aware undo/redo backed by `Y.UndoManager`, scoped to changes created by the local binding.
- Optionally publish local presence and selections and render remote selections/carets. Positions use Yjs relative positions so they survive concurrent edits.
- Define explicit shared-document initialization semantics. The shared `Y.Text` is authoritative; a helper may seed it only when empty, and automatic per-client insertion of `initialValue` is forbidden.
- Add deterministic in-memory network simulation, provider contract tests, two-editor integration tests, randomized convergence tests, and Electron two-window smoke coverage.
- Update package exports, root build configuration, documentation, and roadmap status.

## Impact

- Affected specs:
  - `realtime-collaboration` (new capability)
  - `plugin-editor-extensions` (existing transaction/origin and lifecycle guarantees are exercised but not weakened)
- Affected code:
  - `packages/plugin-collab/` (new package)
  - `package.json` and `vitest.config.ts` (workspace build/test aliases)
  - `apps/electron-demo/` (opt-in two-window collaboration smoke harness)
  - `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`, and package documentation
- New production dependencies:
  - `yjs`
  - `y-protocols` only if the optional awareness integration cannot be typed and implemented safely without it
- Compatibility:
  - No change for editors that do not install the collaboration plugin.
  - Existing `plugin-history` MUST NOT be used as the collaboration undo authority for a collaborative document; the collaboration package owns undo/redo while active.
- Security boundary:
  - The plugin never receives credentials and never opens a network connection. Provider authentication and document authorization remain host responsibilities.

## Out of Scope

- A hosted collaboration server or account system.
- Shared comments, annotations, mentions, tracked changes, or review mode.
- Snapshot/version-history UI.
- End-to-end encryption or server-side access policy.
- CRDT engines other than Yjs in the first implementation.
- Synchronizing rendered DOM, mdast objects, or Live Preview widgets as shared state; only Markdown text and ephemeral awareness are synchronized.

