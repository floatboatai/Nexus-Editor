# Editor Core Spec — Scroll Event, Preview HTML Rendering

## ADDED Requirements

### Requirement: Scroll Position Event

`EditorEventMap` SHALL include a `scroll` event emitting `{ offset: number; ratio: number }`, where `offset` is the document character offset at the top of the visible editor viewport and `ratio` is the fractional scroll position within the rendered height of the document line containing that offset (a line-based unit, symmetric with `scrollToOffset`). The event SHALL be throttled to at most one emission per animation frame.

#### Scenario: Scrolling the editor emits an offset
- **WHEN** the user scrolls the editor viewport
- **THEN** a `scroll` event SHALL fire with `offset` equal to the document position at the top of the visible content

#### Scenario: Rapid scrolling is throttled
- **WHEN** multiple native scroll events fire within a single animation frame
- **THEN** at most one `scroll` event SHALL be emitted for that frame

### Requirement: Scroll To Offset

`EditorAPI` SHALL expose `scrollToOffset(offset: number, ratio?: number): void`, the write-side counterpart to the `scroll` event: it SHALL scroll the editor so that the given document character offset is positioned at the top of the viewport (adjusted by `ratio` within the rendered height of the offset's document line when provided — the same line-based unit the `scroll` event reports), without requiring the caller to know CM6 screen-coordinate geometry.

#### Scenario: Scrolling to an offset moves the viewport
- **WHEN** `scrollToOffset(500)` is called
- **THEN** the editor's viewport SHALL scroll so that document offset 500 is at (or adjacent to) the top of the visible content

### Requirement: Preview HTML Rendering

`@floatboat/nexus-core` SHALL export `renderPreviewHtml(ast: Root): string`, converting an mdast tree into an HTML string via the existing `remark-rehype` / `rehype-stringify` pipeline, without re-parsing markdown text. Every block-level element in the output SHALL carry a `data-offset` attribute equal to its source mdast node's `position.start.offset`. Inline formatting nested inside block nodes (emphasis, strong, links, inline code) SHALL be preserved in the output, not flattened to plain text.

#### Scenario: Rendering carries offsets
- **WHEN** `renderPreviewHtml` is called with an AST containing a heading at offset 0 and a paragraph at offset 20
- **THEN** the returned HTML SHALL contain elements with `data-offset="0"` and `data-offset="20"` respectively

#### Scenario: No new parse pass
- **WHEN** `renderPreviewHtml(editor.getAst())` is called
- **THEN** the markdown source SHALL NOT be re-parsed by `remark-parse` — only the already-produced tree is transformed

#### Scenario: Inline formatting is preserved
- **WHEN** the AST contains a heading whose text includes a `strong` (bold) child node
- **THEN** the returned HTML SHALL render that heading with a nested `<strong>` element, not as flattened plain text
