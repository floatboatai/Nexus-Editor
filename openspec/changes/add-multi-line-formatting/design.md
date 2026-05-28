# Design: Multi-line formatting support

## Context

The formatting toolbar performs text manipulation by inserting/removing markdown markers. Previously this operated on single-line selections only. Multi-line selection requires:

1. Expanding the selection to full line boundaries
2. Separating list prefixes (`1. `, `- `, `* `, `> `) from content
3. Applying marker toggle per-line with boundary rebalancing
4. Preventing list markers from being selected

## Goals / Non-Goals

- **Goals**:
  - All formatting buttons work on multi-line selections
  - List markers are never included in the formatted range
  - Star-count algorithm handles asymmetric `*`/`**` markers across lines
  - Inline HTML (`<span>`, `<u>`) renders inline in list items
  - Cursor cannot land on list markers; multi-line selections exclude markers
- **Non-Goals**:
  - Cross-paragraph formatting (each paragraph is independent)
  - Nested list renumbering after reorder
  - Keyboard-only selection guard (mouse-based only)

## Decisions

### Decision: Extract line content before formatting

`extractLineContent(line)` splits a line into `{ prefix, content }` where prefix is the list marker (`- `, `1. `, `* `, `> `) and content is the rest. Formatting operates on content only, and the prefix is reattached afterward.

**Alternatives considered**:

- Regex matching per marker type — more code, harder to maintain
- AST-based approach — slower, depends on parser

### Decision: Star-count algorithm for `*`/`**`

When toggling bold/italic on multi-line, the algorithm:

1. For each selected line, counts inside-stars (after content start) and outside-stars (before content start)
2. Computes target = 1 or 2 based on whether user wants bold or italic toggle
3. For lines where inside-stars differ from target, replaces the marker
4. For partial boundary lines, rebalances: if the adjacent content starts with the marker, treat it as a closing marker (remove), otherwise as opening marker (keep/add)

**Rationale**: Handles asymmetric markers (e.g., `**text*` → toggle bold → `*text*` or `***text*`) correctly by counting from both ends.

### Decision: `applyInlineHtml` unified helper

Color and highlight tags share identical logic: find opening/closing tag pairs, determine if content is wrapped, toggle. The helper takes tag regex patterns and generates the toggle logic. This avoids duplicating the multi-line loop + list-marker-exclusion logic.

### Decision: `inline: true` flag on Html nodes

Rather than changing the Lezer parser or creating a new AST node type, the `adaptListItem` function in `lezer-mdast-adapter.ts` detects single-line `HTMLBlock` children (no `\n` in source) and sets an `inline: true` property on the resulting `Html` node. `buildHtmlDecorations` checks this flag and uses an inline `<span>` with `Decoration.replace` (no `block: true`) instead of the default `<div class="nexus-html-block">` block widget.

**Alternatives considered**:

- Modify `adaptParagraph` to not promote `HTMLTag`-containing paragraphs — would break standalone HTML blocks
- Use CSS `display: inline` on block widgets — doesn't work with CM6's block widget heightmap

### Decision: `Prec.highest` event handlers for list marker guard

`Prec.highest` ensures the list marker guard handlers run before CM6's own mouse event processing. Two handlers:

- `mousedown`: if click position is within a marker range, `preventDefault()` + dispatch cursor to `markerEnd`
- `mouseup`: if a non-empty selection has anchor/head in marker ranges, correct them to `markerEnd` via `requestAnimationFrame` dispatch

**Rationale**: Must run before CM6 to prevent its click → cursor logic from placing the cursor inside a marker range. The `requestAnimationFrame` in mouseup avoids interfering with CM6's selection finalization.

## Risks / Trade-offs

- **Module-level `listMarkerRanges` mutable state**: Persists across decoration rebuilds, initialized to `[]` at `buildDecorations` start. Risk: if `buildDecorations` throws mid-execution, stale ranges could affect next mouse event. Mitigation: reset at function entry; array is scoped to the decoration build cycle.
- **`inline: true` is a non-standard property**: The `Html` mdast type doesn't declare `inline`. Downstream consumers that do `JSON.parse(JSON.stringify(ast))` won't see it. Mitigation: only used internally by `buildHtmlDecorations`; serialization-safe.
