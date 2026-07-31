# Change: Add an AI-ready document operation layer

## Why

Nexus-Editor already exposes a live mdast tree, but external agents can only
replace the entire markdown document. A stable node identity and small,
transactional document patch API will let integrations target a paragraph,
heading, or other mdast node without introducing an AI runtime or changing the
normal editor input path.

## What Changes

- Add an immutable, editor-lifetime-stable `id` to every node exposed through a
  document operation tree.
- Add `editor.document.getTree()`, `findNode(nodeId)`, and `getPath(nodeId)`.
- Add `replace`, `insert`, and `delete` document patches, applied through the
  existing editor transaction/update path.
- Preserve existing `getDocument()`, `getAst()`, `setDocument()`, selection,
  undo/redo, and user-edit behavior.
- Add core tests for identity, lookup, paths, and all patch operations.
- Add a small Electron demo action and README documentation showing a mock AI
  rewrite.

## Impact

- Affected specs: `editor-core` (new document operation capability)
- Affected code: `packages/core/src/types.ts`, `packages/core/src/editor.ts`,
  document-operation helpers/tests, Electron demo, and README.
- No AI SDK, LLM provider, MCP integration, or new runtime service.
- Patch operations produce one normal editor transaction, so they participate
  in the existing change event and undo history.
