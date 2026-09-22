# Change: Transport-independent CRDT collaboration

## Why

Roadmap item 18 requires a collaboration primitive that preserves Markdown as
the document. Concurrent edits cannot safely be synchronized with whole-document
`setDocument()` calls: those calls lose concurrent work and mix remote edits into
local undo history.

## What Changes

- Add an optional `plugin-collab` package backed by host-owned Yjs documents.
- Bind CodeMirror changes to CRDT operations and apply remote operations without
  re-publishing them or letting local filters reject already-committed CRDT state.
- Add per-editor selective undo, relative selection restoration, optional
  awareness cursors, and deterministic resource cleanup.
- Preserve live preview while editing collaborative tables as Markdown source.
- Add transport simulation tests for partitions, duplicate and reordered updates.

## Impact

- Affected specs: collaboration, plugin-editor-extensions.
- Affected code: core history dispatch, transaction pipeline, live-preview config;
  new plugin-collab package and workspace package registration.
- No network provider, server, authentication, or persistent storage is bundled.
- Yjs and y-protocols are MIT-licensed peer dependencies of the optional package.

## Review status

Proposed for maintainer review. This draft includes a reference implementation
requested by the contributor; it does not imply maintainer approval of the
proposal, dependencies, roadmap priority, or AI-assisted contribution.
