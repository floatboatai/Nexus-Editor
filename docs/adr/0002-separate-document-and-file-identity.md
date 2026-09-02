---
status: proposed
date: 2026-09-03
---

# Separate Collaborative Document identity from file identity

Every Collaborative Document will use an opaque, Host-persisted DocumentId that is independent of path and File Identity. The Host explicitly enrolls a Markdown Document by creating or joining with that DocumentId and maintains the association across rename, move, window, process, and device boundaries. This avoids routing collaboration through mutable paths or Host-local inode-style identities while keeping file storage outside the headless collaboration interface.

## Consequences

- `create` and `join` are distinct product operations; an empty replica never implies creation.
- A Host that cannot durably preserve the association cannot claim rename-safe or cross-device collaboration.
- File deletion does not implicitly delete the remote Collaborative Document; remote deletion is a separate authorized product operation.
