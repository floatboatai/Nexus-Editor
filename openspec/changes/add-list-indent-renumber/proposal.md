# Change: Markdown-aware list indent / outdent with ordered-list renumbering

## Why

Tab in a list item currently runs CodeMirror's generic `indentWithTab`, which
inserts a fixed indent unit. That is not how Markdown nesting works: CommonMark
nests a list item under the previous one only when it is indented to that
item's *content column* — two spaces after `- `, three after `1. `, four after
`10. `. So Tab on `2. b` below `1. a` yields `  2. b`, which Lezer (and every
CommonMark renderer) still reads as a sibling. The live preview shows no
nesting and the user has no way to discover why.

Ordered lists also drift out of sequence on ordinary edits. Enter in the
middle of `1. 2. 3.` inserts `2.` and leaves the old `2.` and `3.` behind;
emptying an item leaves a gap. Renderers tolerate this, but the document is
the product here — the source should stay tidy without a manual pass.

## What Changes

- **ADDED** `indentListItem(view)` / `outdentListItem(view)` commands in
  `@floatboat/nexus-core`, bound to `Tab` / `Shift-Tab` in `markdownKeymap()`
  ahead of `indentWithTab`. They act only when a selection range touches a
  list item's marker line; otherwise they return `false` so the key falls
  through to plain indentation.
  - Indent nests the item under its previous sibling (or the last item of a
    directly preceding list) at that item's content column. The first item
    of a list has nothing to nest under and is left unchanged.
  - Outdent lifts the item to its parent's indentation; siblings that
    followed it become its children and are aligned to its new content
    column. Top-level items only lose stray indentation.
  - Nested children and continuation lines move with the item; blank lines
    stay blank and lazy continuation lines without a `>` prefix are left
    alone inside blockquotes.
  - Consecutive selected siblings move as one unit; multiple cursors are
    handled in one transaction.
- **ADDED** ordered-list renumbering. After an indent, outdent, or Enter
  continuation / exit, every ordered list in the affected list tree is
  renumbered consecutively in the same transaction (one undo step). A list
  keeps its written start number unless its first item was re-parented by
  the command, in which case it restarts at 1. When a marker changes width
  (`9.` → `10.`) the item's continuation lines are re-indented so nested
  content stays nested.
- **MODIFIED** `handleMarkdownEnter` now dispatches through the renumbering
  pass. Behaviour without the Lezer language extension is unchanged.

No breaking changes. Structure detection uses the editor's existing Lezer
syntax tree, so paragraph continuation, fenced code inside items, and
blockquote prefixes are all resolved by the parser rather than by regexes.

## Impact

- Affected specs: `editor-core` (keymap and list editing requirements)
- Affected code:
  - `packages/core/src/markdown-list.ts` (new)
  - `packages/core/src/markdown-keymap.ts` (Tab bindings, Enter renumbering)
  - `packages/core/src/index.ts` (exports)
  - `packages/core/test/markdown-list.test.ts` (new)
  - `packages/core/README.md`, `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- New runtime dependencies: none (`@codemirror/language` and `@lezer/common`
  are already core dependencies).
- Out of scope: Backspace at the start of an item, converting between bullet
  and ordered markers when an item changes list type, and a toolbar button —
  hosts can bind the exported commands themselves.
