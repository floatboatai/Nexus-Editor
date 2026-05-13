# Change: Add Realtime Collaboration Plugin

## Why

Nexus Editor has local-first editing, vault navigation, wiki links, and plugin APIs, but no multi-user editing model. Roadmap #18 calls for realtime collaboration as a long-term capability. This needs a design-first change because collaboration affects document authority, conflict resolution, cursor presence, persistence, and host infrastructure boundaries.

## What Changes

- Add a new `@floatboat/nexus-plugin-collab` package centered on CodeMirror 6 collaboration bindings.
- Use a CRDT-based model for shared document state. The proposed implementation target is Yjs because it is peer/order tolerant, supports offline replay, and has established CodeMirror integration patterns.
- Keep networking host-owned. The plugin accepts a provider adapter instead of bundling a server, websocket endpoint, auth, or storage backend.
- Define public types for:
  - `CollabProvider` lifecycle and sync events.
  - `CollabAwareness` user presence, remote selections, and cursors.
  - `createCollabPlugin(options)` for editor integration.
- Add an electron-demo-only in-memory or localhost provider as a smoke-test harness, not a production sync backend.
- Document non-goals: comments, mentions, permissions, cloud storage, version history, and multi-vault sync.

## Impact

- Affected specs:
  - `collaboration` (new capability)
- Affected code in the implementation phase:
  - `packages/plugin-collab/` (new package)
  - root workspace/package scripts for build and publish inclusion
  - `apps/electron-demo` optional demo harness
  - `README.md` / `README.zh.md` package table
  - `docs/ROADMAP.md` / `docs/ROADMAP.zh.md`
- New dependencies in the implementation phase:
  - likely `yjs`
  - likely a CodeMirror/Yjs binding package or a small internal binding if the external binding is unsuitable
- Breaking changes: none intended. Collaboration is opt-in via a new plugin.
