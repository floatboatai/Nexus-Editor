## ADDED Requirements

### Requirement: Stable document operation nodes

The editor SHALL expose a document operation tree whose nodes have unique IDs,
node types, optional values, and recursively exposed children. IDs SHALL remain
stable for matching nodes for the lifetime of an editor instance and SHALL NOT
be written into markdown.

#### Scenario: Read a document tree

- **WHEN** a consumer calls `editor.document.getTree()`
- **THEN** it receives a root node and every reachable node has a unique ID

#### Scenario: Node identity survives an unrelated edit

- **WHEN** text is inserted before an existing paragraph and the document is
  reparsed
- **THEN** the existing paragraph keeps its operation-node ID

### Requirement: Document node lookup

The editor SHALL provide lookup by node ID and SHALL return the node's path as
an ordered list of mdast node types from root to that node. Unknown IDs SHALL return
`null` (or an empty path, as specified by the public type) without mutating the
document.

#### Scenario: Find a node and its path

- **WHEN** a consumer passes a node ID returned by `getTree()`
- **THEN** `findNode` returns that node and `getPath` identifies its ancestry

### Requirement: Structured document patches

The editor SHALL support replace, insert, and delete patches addressed by node
ID. Each valid patch SHALL update the existing editor document through one
normal transaction, participate in undo history, and emit the existing change
notification. Invalid or stale patches SHALL fail without a partial update.

#### Scenario: Replace a node

- **WHEN** a consumer applies a replace patch to a paragraph ID with new
  markdown content
- **THEN** only that node's source range is replaced and the editor exposes the
  updated markdown and tree

#### Scenario: Insert a sibling node

- **WHEN** a consumer applies an insert patch to a parent with a valid sibling
  position and markdown fragment
- **THEN** the fragment appears at that position and receives operation-node IDs

#### Scenario: Delete a node

- **WHEN** a consumer applies a delete patch to a non-root node ID
- **THEN** that node is removed and the remaining tree is still queryable

### Requirement: Backward compatibility

The document operation layer SHALL be optional and SHALL NOT change the
behavior or signatures of existing document and editing APIs.

#### Scenario: Existing document API remains usable

- **WHEN** an existing consumer uses `getDocument()`, `getAst()`, or
  `setDocument()` without the operation layer
- **THEN** those calls behave as before
