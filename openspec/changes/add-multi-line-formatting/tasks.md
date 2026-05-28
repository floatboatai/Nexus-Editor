# Tasks: Add multi-line selection support

## Phase 1: Core multi-line formatting

- [x] 1.1 Implement `extractLineContent` and `getSelectionLineRange` helpers in `formatting.ts`
- [x] 1.2 Multi-line bold/italic with star-count algorithm in `toggleWrap` (index.ts)
- [x] 1.3 Multi-line underline (`toggleUnderline`) in index.ts
- [x] 1.4 Multi-line strikethrough in `toggleStrikethrough` (index.ts)
- [x] 1.5 Multi-line inline code in `toggleInlineCode` (index.ts)
- [x] 1.6 Multi-line heading (H2) in `toggleHeading` (index.ts)
- [x] 1.7 Multi-line blockquote in `toggleBlockquote` (formatting.ts)
- [x] 1.8 Multi-line ordered/unordered list in `toggleOrderedList`/`toggleUnorderedList` (formatting.ts)

## Phase 2: Color and highlight multi-line

- [x] 2.1 Implement `applyInlineHtml` unified helper in formatting.ts
- [x] 2.2 Multi-line text color (`applyTextColor`) delegating to `applyInlineHtml`
- [x] 2.3 Multi-line highlight (`applyHighlight`) delegating to `applyInlineHtml`
- [x] 2.4 List marker exclusion for color/highlight via `extractLineContent`

## Phase 3: Live preview fixes

- [x] 3.1 Mark single-line `HTMLBlock` in list items with `inline: true` in `lezer-mdast-adapter.ts`
- [x] 3.2 Add inline HTML rendering path in `buildHtmlDecorations` (live-preview.ts)
- [x] 3.3 Collect list marker ranges in `buildListDecorations`
- [x] 3.4 Add `user-select: none` on bullet widgets
- [x] 3.5 Add `Prec.highest` mousedown guard to prevent cursor on list markers
- [x] 3.6 Add mouseup guard to correct multi-line selections including markers

## Phase 4: Testing

- [x] 4.1 83 toolbar tests covering all multi-line scenarios
- [x] 4.2 Live preview tests for inline HTML in list items (no line break)
- [x] 4.3 Live preview tests for list marker unselectable (user-select:none, cursor guard)
- [x] 4.4 AST adapter test for inline HTML flag in list items
