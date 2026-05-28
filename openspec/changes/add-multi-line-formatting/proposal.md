# Change: Add multi-line selection support for all formatting toolbar buttons

## Why

The formatting toolbar (bold, italic, underline, strikethrough, inline code, heading, blockquote, text color, highlight) previously only worked on single-line selections. Selecting text across multiple lines and clicking a formatting button would either fail silently or produce incorrect results (e.g., applying markers only to the cursor line, wrapping list markers instead of content). This blocked common workflows like formatting entire paragraphs or multi-line text ranges.

Additionally, inline HTML tags (`<span style="color:...">`, `<u>`) inside list items caused visual line breaks in live preview because the Lezer parser classifies them as block-level `HTMLBlock` nodes, which were rendered via `display:block` widgets.

Finally, list markers (`1. `, `- `, `* `) were selectable — users could place the cursor on the marker or include markers in multi-line selections, leading to unintended formatting results.

## What Changes

### Multi-line formatting support
- **Bold** (`**`): star-count algorithm computes toggle target from asymmetric star markers across lines
- **Italic** (`*`): same star-count algorithm, rebalances markers at selection boundaries
- **Underline** (`<u>`/`</u>`): wraps/unwraps each selected line, excluding list prefixes
- **Strikethrough** (`~~`): wraps/unwraps each selected line, handles partial selections
- **Inline code** (`` ` ``): wraps/unwraps each selected line, handles partial selections
- **Heading** (`##`): toggles H2 prefix on each selected line
- **Blockquote** (`>`): toggles quote prefix on each selected line, handles empty quote exit
- **Ordered/Unordered list**: toggles list markers on each selected line
- **Text color** (`<span style="color:...">`): applies/removes color spans per line, excluding list markers
- **Highlight** (`<mark>`): applies/removes highlight tags per line, excluding list markers

### Live preview fixes
- **Inline HTML in list items**: `<span>` and `<u>` nodes marked with `inline: true` in the mdast adapter; `buildHtmlDecorations` uses inline `<span>` widgets instead of block-level `<div>` wrappers
- **List marker guard**: `Prec.highest` mousedown handler prevents cursor from landing on list markers; mouseup handler corrects multi-line selections that include marker ranges; bullet widgets have `user-select: none`

### New helpers
- `extractLineContent`: separates list prefix (`1. `, `- `, `* `, `> `) from content text
- `getSelectionLineRange`: expands a selection to full line boundaries
- `applyInlineHtml`: unified multi-line logic for color and highlight tag toggles
- `stripAllMarkers`: strips all formatting markers from a line (vs `unwrapLine` for single marker)

## Impact

- Affected specs: `live-preview`, `plugins` (toolbar)
- Affected code:
  - `packages/plugin-toolbar/src/index.ts` — `toggleWrap` multi-line, `toggleUnderline`, `toggleHeading`, `toggleStrikethrough`, `toggleInlineCode`
  - `packages/plugin-toolbar/src/formatting.ts` — `toggleBlockquote`, `applyTextColor`, `applyHighlight`, `applyInlineHtml`, `extractLineContent`, `getSelectionLineRange`
  - `packages/plugin-toolbar/src/toolbar-ui.ts` — underline button uses `toggleUnderline`
  - `packages/core/src/lezer-mdast-adapter.ts` — inline HTML detection in `adaptListItem`
  - `packages/core/src/live-preview.ts` — inline HTML widget rendering, list marker guard
  - `packages/plugin-toolbar/test/plugin-toolbar.test.ts` — 83 tests
  - `packages/core/test/live-preview.test.ts` — 49 tests
  - `packages/core/test/live-preview-ranges.test.ts` — 4 tests
- **No breaking changes** to existing API
- **136 tests passing** across all affected test suites
