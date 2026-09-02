# Tasks: add-list-indent-renumber

## 1. List structure helpers (`packages/core/src/markdown-list.ts`)

- [x] 1.1 Resolve list items from the Lezer tree: item starting on a line, previous / next sibling, parent item, indent and content column relative to the enclosing blockquote prefix
- [x] 1.2 Collect the items touched by every selection range, dropping items whose ancestor is also selected and grouping consecutive siblings
- [x] 1.3 Per-line indentation shifts that skip blank lines and lazy continuation lines, never remove more indentation than a line has, and measure tabs in columns via `countColumn` with the editor's `tabSize`
- [x] 1.4 Incremental headless re-parse of the post-edit document (`TreeFragment` + the state's Markdown parser) so renumbering never stages a throwaway `EditorState`

## 2. Commands

- [x] 2.1 `indentListItem` — nest under the previous sibling's content column, fall through when no list item is touched
- [x] 2.2 `outdentListItem` — lift to the parent's indent, re-parent following siblings, strip stray top-level indentation
- [x] 2.5 `backspaceListItem` — outdent a nested item, unlist a top-level item (marker, task box, continuation shift), fall through elsewhere
- [x] 2.3 Ordered-list renumbering over the outermost list tree, with start-number reset for re-parented items and continuation re-indent on marker width changes
- [x] 2.4 Compose the structural edit and the renumbering into a single transaction with mapped selection

## 3. Keymap integration

- [x] 3.1 Bind `Tab` / `Shift-Tab` / `Backspace` in `markdownKeymap()` (already `Prec.high`, so it precedes `indentWithTab`)
- [x] 3.2 Route `handleMarkdownEnter` through the renumbering pass when an ordered item is involved; add read-only, code-block and cursor-before-content guards
- [x] 3.3 Export `indentListItem` / `outdentListItem` / `backspaceListItem` from `@floatboat/nexus-core`

## 4. Tests (`packages/core/test/markdown-list.test.ts`)

- [x] 4.1 Indent: bullet, ordered content column, wide markers, custom start preserved, joining an existing nested list, children and continuation lines, loose lists, task items, blockquotes, cross-list anchor, first-item no-op, fall-through, grouped selection, multi-cursor, cursor mapping, single undo step, read-only
- [x] 4.2 Outdent: parent level, following siblings re-parented and renumbered, marker-width alignment, custom start preserved, children move, one level at a time, stray indentation, top-level no-op, blockquotes, grouped selection, cursor mapping, round-trip, single undo step
- [x] 4.3 Enter: renumber after insert, after exit, nested list only, marker width growth re-indents children, mismatched delimiters untouched, bullet lists untouched, single undo step, nine-digit cap, cursor before content, code fence, read-only
- [x] 4.5 Tabs and multi-cursor: tab-indented anchor and children, partial tab removal, later cursor overriding an earlier item's follower alignment, blank-line-separated lists
- [x] 4.4 Keymap: Tab / Shift-Tab / Backspace bindings, `createEditor` end-to-end producing a nested list in the AST
- [x] 4.6 Backspace: top-level unlist, task box, empty item, list continuation renumber, following list restart, continuation shift, nested outdent, blockquote prefix, multi-cursor, position and selection fall-through, code fence, read-only, single undo step

## 5. Documentation

- [x] 5.1 `packages/core/README.md` — list editing section
- [x] 5.2 `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` — new row under Toolbar / Text Editing

## 6. Verify

- [x] 6.1 `pnpm typecheck`
- [x] 6.2 `pnpm test`
- [ ] 6.3 `openspec validate add-list-indent-renumber --strict` — CLI not available in the contributor environment; format hand-checked against `openspec/AGENTS.md`
