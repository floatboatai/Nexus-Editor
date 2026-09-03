# Change: Add realtime collaborative editing

## Why

Roadmap #18 requires more than connecting two CodeMirror views. The first implementation proved the framework-neutral Engine and Core authority seam, but the visible Host path still used an in-memory assessment Provider and volatile Store. It therefore could not satisfy the product meaning of collaboration: two independently authenticated processes or devices editing a real Markdown Document, surviving disconnect and restart, and coordinating external file changes without silent overwrite.

This expanded change completes that product slice while preserving the existing deep `CollaborationEngine` interface. Real network, persistence, file, and Host workflow behavior enter through explicit adapters at the already-defined seams. Assessment adapters remain deterministic test tools and are no longer the primary acceptance path.

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
- Add a real authenticated WebSocket Provider adapter and runnable reference collaboration server with read/write authorization, durable state, health reporting, bounded inputs, and restart recovery.
- Add a browser IndexedDB Replica Store and an Electron single-writer SQLite broker using the supported runtime's built-in `node:sqlite` capability.
- Add File Projection with durable File Identity enrollment, atomic writes, Projection Base tracking, watcher-echo suppression, deterministic three-way reconciliation, and explicit conflict resolution.
- Add a Host-owned Collaboration Workspace and Electron workflow for create, join, leave, reconnect, read-only, peer/status display, and conflict recovery without introducing a second collaboration state machine.
- Qualify the complete vertical slice across independent clients, disconnect/reconnect, process restart, authorization failure/revocation, external file modification, cleanup, security bounds, and sustained-update tests.

## Non-Goals

- A managed multi-tenant SaaS, billing, organization administration, or multi-region autoscaling control plane.
- End-to-end encryption, shared comments, `@mention`, or version-history product features.
- Automatic semantic conflict resolution when a three-way Markdown merge cannot prove a safe result.
- A claim that the reference deployment has an external production SLO, independent security audit, or multi-region disaster recovery. The implemented adapters can be real and durable without inventing operational evidence that this repository cannot provide.

## Impact

- Affected specs:
  - `editor-authoritative-source` (new capability)
  - `collaboration-engine` (new capability)
  - `collaboration-provider` (new capability)
  - `collaboration-persistence` (new capability)
  - `collaboration-file-projection` (new capability)
  - `collaboration-workspace` (new capability)
  - `plugin-editor-extensions` (authority semantics added to the existing transaction contract)
- Affected packages and applications:
  - `packages/core`
  - new `packages/plugin-collab`
  - `packages/react` and `packages/vue` documentation/contract fixtures only unless an existing readiness seam is insufficient
  - optional thin native adapter using public `plugin-api` lifecycle interfaces
  - `apps/electron-demo`
  - new runnable `apps/collab-server` reference deployment
- Dependencies:
  - `yjs@13.6.32` — MIT — peer plus development dependency for CRDT document semantics
  - `y-protocols@1.0.7` — MIT — direct dependency for Awareness and protocol types
  - Hocuspocus client/server packages are isolated to explicit Provider/server entries and do not enter Core or the ordinary collaboration bundle
  - native IndexedDB and built-in `node:sqlite` avoid a native SQLite addon; test-only IndexedDB emulation remains a development dependency
- Compatibility:
  - Existing Editors have no authoritative source by default and retain current proposal, history, and table behavior.
  - Collaboration is opt-in and its default package entry remains browser-safe.
  - Existing assessment imports continue to work.
  - The default collaboration entry stays browser-safe; Node/Electron/server dependencies are reachable only through explicit exports or application packages.
  - Support claims remain evidence-scoped: implemented product behavior is distinguished from hosted-service operational qualification.

## Submission Constraint

The take-home instructions require one final PR with no intermediate approval round. That PR is therefore both the proposal review surface and the implementation review surface. This records the exception transparently; it does not rewrite repository governance, mark the proposed ADRs accepted, or allow the OpenSpec change to be archived before merge.
