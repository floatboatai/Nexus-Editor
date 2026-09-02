# Change: Add realtime collaborative editing

## Why

Roadmap #18 requires more than connecting two CodeMirror views: Nexus needs a framework-neutral collaboration module whose local edits remain subject to editor policy, whose committed CRDT updates cannot be rewritten by local filters, and whose lifecycle is safe across multiple Editors. The take-home submission permits one complete final PR and no intermediate approval round, so this change describes the whole reviewable assessment delivery instead of creating a temporary interface or a chain of implementation PRs.

The submitted capability is intentionally labelled `experimental`. It proves the final Engine seam, Yjs convergence, history ownership, Presence, integration paths, and cleanup without claiming that a test Provider or volatile Store is a production collaboration backend.

## What Changes

- Add an owner-scoped, per-Editor exclusive authoritative source registration to Core.
- Distinguish filterable Local Proposals from non-rewritable Authoritative Updates in transaction and update contexts.
- Route every Undo/Redo entry point through the authoritative source's mandatory history controller.
- Enable source-owned external-document behavior that prevents live-preview table text from remaining only in DOM.
- Add browser-safe `@floatboat/nexus-plugin-collab` with a headless `CollaborationEngine` interface.
- Use `yjs@13.6.32` and `y-protocols@1.0.7` behind Nexus-owned interfaces; do not expose third-party Provider types to Engine callers.
- Separate explicit `create` from `open`/join, use stable opaque `DocumentId`, and gate first attachment on authoritative content readiness.
- Bind accepted Local Proposals into `Y.Text("content")` and project remote Yjs updates through Core's authoritative source without feedback loops.
- Give every Editor Binding its own local origin and `Y.UndoManager`, while multiple bindings share one Replica per DocumentId in a JavaScript realm.
- Add Nexus Provider and Replica Store seams, deterministic in-memory contract adapters, and an explicit volatile mode. No adapter in this PR receives a production-support claim.
- Add Awareness-based Presence with relative selections, throttling, input sanitization, expiry, and lifecycle cleanup.
- Document one Engine path for direct Core, React, Vue, and an optional thin native lifecycle adapter; no framework-specific collaboration state machine is introduced.
- Add an Electron demo integration for two Editors/windows using the assessment adapter, clearly labelled non-production.
- Add contract, convergence, IME, table, lifecycle, framework, demo, resource-cleanup, and benchmark-baseline coverage.

## Non-Goals

- A hosted collaboration SaaS, account system, invitation UI, billing, or production deployment.
- A production-qualified Hocuspocus/Y-Sweet adapter or a bundled vendor SDK.
- SQLite/IndexedDB durability, server acknowledgement, backup, multi-device production qualification, or an offline-retention promise.
- Bidirectional Markdown file projection, Projection Base reconciliation, or conflict-resolution UI.
- End-to-end encryption, shared comments, or `@mention` schema.
- A `production-supported` claim. Those capabilities remain in the product design and qualification matrix and require separate evidence after the assessment.

## Impact

- Affected specs:
  - `editor-authoritative-source` (new capability)
  - `collaboration-engine` (new capability)
  - `plugin-editor-extensions` (authority semantics added to the existing transaction contract)
- Affected packages and applications:
  - `packages/core`
  - new `packages/plugin-collab`
  - `packages/react` and `packages/vue` documentation/contract fixtures only unless an existing readiness seam is insufficient
  - optional thin native adapter using public `plugin-api` lifecycle interfaces
  - `apps/electron-demo`
- Dependencies:
  - `yjs@13.6.32` — MIT — peer plus development dependency for CRDT document semantics
  - `y-protocols@1.0.7` — MIT — direct dependency for Awareness and protocol types
  - no Hocuspocus, Y-Sweet, SQLite driver, or production server dependency
- Compatibility:
  - Existing Editors have no authoritative source by default and retain current proposal, history, and table behavior.
  - Collaboration is opt-in and its default package entry remains browser-safe.
  - The PR may be merged only as `experimental`; the broader product design defines the later evidence required for stronger support claims.

## Submission Constraint

The take-home instructions require one final PR with no intermediate approval round. That PR is therefore both the proposal review surface and the implementation review surface. This records the exception transparently; it does not rewrite repository governance, mark the proposed ADRs accepted, or allow the OpenSpec change to be archived before merge.
