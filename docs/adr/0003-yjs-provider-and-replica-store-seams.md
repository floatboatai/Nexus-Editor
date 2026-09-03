---
status: proposed
date: 2026-09-03
---

# Use Yjs 13 behind independent Provider and Replica Store seams

The first collaboration line will use `yjs@13.6.32` and `y-protocols@1.0.7`, while the public Collaboration Engine interface remains free of third-party Provider and storage types. Hocuspocus 4.6 is the first production Provider qualification candidate, Y-Sweet 0.9.1 is the second independent adapter, and the basic `y-websocket@3.1.0` server path is limited to protocol tests. Electron durability will use a Host-owned, single-writer SQLite update journal and snapshot store behind a Replica Store interface, subject to a supported Electron upgrade and native packaging qualification. This keeps CRDT semantics stable while allowing deployment, authentication, and storage implementations to vary without changing Engine callers.

## Consequences

- Yjs 14 `@y/*` packages cannot be mixed into the Yjs 13 dependency graph.
- Provider states only claim connection, synchronization, acknowledgement, or durability when the selected adapter can prove each fact.
- Hocuspocus, Y-Sweet, SQLite, and any native driver remain adapter implementation details.
- `better-sqlite3` cannot enter runtime dependencies until the supported Electron and packaged-platform spike passes.
