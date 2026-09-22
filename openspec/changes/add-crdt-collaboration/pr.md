# Add transport-independent Yjs collaboration

Synchronizing Markdown snapshots loses concurrent edits and mixes peer changes
into local history. Add an optional `@floatboat/nexus-plugin-collab` package that
binds each editor to host-owned Y.Text, merges offline operations, and selectively
undoes only that editor's edits. Include relative selections, optional awareness
cursors, lifecycle cleanup, integration documentation and a two-replica demo.

Core gains a generic history backend, authoritative remote transaction handling,
and an opt-in table source mode. Collaboration uses table source editing to avoid
deferred cell commits overwriting peer changes; other live preview remains active.
Hosts supply providers, authentication, persistence and one-time initialization.

Validation: 72 test files / 932 tests passed; workspace typecheck, package builds,
public API checks, demo build, strict OpenSpec validation and diff whitespace
checks passed. Demo build reports large chunks; interactive browser smoke testing
was not performed in this pass.

This is an AI-assisted draft contribution for maintainer review. The proposal,
dependency choice and roadmap priority remain subject to maintainer approval.
