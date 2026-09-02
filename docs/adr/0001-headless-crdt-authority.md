---
status: proposed
date: 2026-09-03
---

# Keep collaboration headless and CRDT-authoritative

Nexus collaboration will be a headless module whose small interface owns replica, binding, synchronization, persistence, presence, and projection coordination. While a Markdown Document is enrolled for collaboration, its Collaborative Document is authoritative; Editors and files are projections. A native plugin may adapt Host lifecycle events to this module but must not own a second collaboration state machine. This preserves the framework-neutral product shape and prevents local filters, files, and network state from becoming competing authorities.

## Considered Options

- A native plugin as the collaboration runtime was rejected because direct Core, React, and Vue callers would need duplicate orchestration or the full plugin runtime.
- A transport-only `send/onMessage` interface was rejected because it does not express synchronization, reconnection, authorization, or Presence lifecycle.
- Treating the Markdown file as a concurrent second authority was rejected because external edits require an explicit Projection Base and reconciliation policy.
