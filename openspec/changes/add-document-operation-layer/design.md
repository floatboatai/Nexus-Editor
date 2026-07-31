## Context

The core editor already maintains a parsed mdast tree and routes document
changes through CodeMirror. The operation layer should be an optional facade on
that existing `EditorAPI`, not a second document model.

## Goals / Non-Goals

- Goals: stable node handles during one editor instance, read-only tree
  snapshots, node lookup/path lookup, and precise patch updates.
- Non-goals: AI execution, network access, collaboration, persisted IDs, or a
  general-purpose mdast editor implementation.

## Decisions

- Expose `editor.document` as a typed `DocumentManager` on `EditorAPI`.
- Return operation nodes as defensive snapshots. The public shape contains
  `id`, `type`, optional `value`, and optional recursively mapped `children`;
  parser-specific fields such as `position` remain internal.
- Allocate IDs from an editor-local counter. Reconcile each new parsed tree
  with the previous operation tree by parent, node type, and sibling order with
  a source-position/content similarity preference. This preserves IDs for
  unchanged nodes and for nodes whose source offsets move. Nodes that are
  replaced by a patch retain their target ID; newly inserted nodes receive new
  IDs. IDs are not persisted in markdown and are invalid after `destroy()`.
- Implement patches by resolving the target node's current source range and
  dispatching one `replaceRange` transaction. `replace` accepts markdown
  content for a node. `insert` accepts a markdown fragment plus the parent and
  sibling position; the fragment is parsed after insertion and receives fresh
  IDs. `delete` removes the target source range, including the surrounding
  block separator where safe.
- Reject stale, unknown, malformed, or structurally invalid patches with a
  descriptive error and leave the document unchanged.
- Return `getPath()` as the ordered mdast type path (for example
  `['root', 'section', 'paragraph']`); callers use the node ID itself for
  addressing.
- Keep patch updates non-silent by default so existing `onChange`/`change`
  behavior and undo history remain intact. A single patch is one undo entry.

## Alternatives considered

- Persist IDs inside markdown: rejected because it changes the document format
  and breaks compatibility with existing files.
- Build a second mutable AST model: rejected because it would diverge from the
  live Lezer/mdast pipeline and risk breaking normal editing.
- Add an AI SDK: rejected because the editor only needs deterministic document
  primitives and must remain provider-neutral.

## Risks / Trade-offs

- Node identity is intentionally scoped to one editor lifetime, so callers must
  refresh handles after destroying/recreating an editor.
- Markdown serialization of inserted node objects is deliberately out of scope
  for the first version; accepting markdown fragments keeps formatting faithful
  and avoids introducing another serializer contract.

## Migration Plan

No migration is required. Existing consumers continue using the current API;
new consumers opt into `editor.document`.
