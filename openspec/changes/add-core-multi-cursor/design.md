# Design — Multi-Cursor / Multi-Selection

## Decision 1: Opt-in config flag, not default-on

`drawSelection()` swaps the native caret/selection rendering for CM-drawn layers (`.cm-cursor`, `.cm-selectionBackground`). That is a visible change for every existing consumer even if they never use a second cursor. `multiCursor` therefore defaults to `false`; the electron demo turns it on so the feature is dogfooded. Flipping the default later is a one-line, separately-reviewable decision.

## Decision 2: Hand-rolled `selectNextOccurrence` instead of `@codemirror/search`

`@codemirror/search` exports a `selectNextOccurrence`, but depending on it from core would pull the search panel/UI module into every core consumer's bundle just for one ~50-line command. `plugin-search` already owns that dependency for hosts that want the full search feature. The in-core implementation is a plain forward scan over `state.doc` with wrap-around:

- If **any** range is empty → expand every empty range to the word around it (`state.wordAt`); this invocation adds no new range (VS Code behaviour). If the main range is empty and has no word under it, return `false`.
- Otherwise → take the main range's text as the query, scan forward from the end of the *last* range, wrapping to the document start; skip occurrences already covered by an existing range; add the first hit as the new **main** range and scroll it into view. No hit anywhere → return `false`.
- Matching is case-sensitive and not word-bounded (same as CM's behaviour once ranges are non-empty).

## Decision 3: `addCursorAbove/Below` move by logical lines, not visual lines

`view.moveVertically` would respect soft-wrap but depends on pixel measurement, which is unreliable headless (jsdom) and irrelevant for the dominant no-wrap markdown-source case. The commands instead compute the target from the document: previous/next logical line, column preserved via `min(column, targetLine.length)`. The cursor is added from the **topmost** range for Above and the **bottommost** for Below, so repeated presses grow a contiguous cursor stack. Deterministic, fully unit-testable.

## Decision 4: Per-range Enter via one combined dispatch

`handleMarkdownEnter` must keep consuming the key only when it has something markdown-specific to do. New contract:

- If **no** range sits on a list/blockquote line → return `false` (default Enter for all cursors, exactly as before for single-cursor on plain text).
- Otherwise build one change set covering **all** ranges: continuation prefix for list/quote lines, empty-item exit (delete line content) for empty items, plain `"\n"` for ranges on non-continuable lines, and non-empty (selection) ranges replace their span with `"\n"`.
- Two cursors on the same empty list item would produce overlapping deletions; the first range on a line wins and subsequent same-line ranges become no-ops (`handledLines` set).

Changes are accumulated with explicit position bookkeeping (`changes` array + per-range new anchors mapped through `state.changes(...)`) rather than N separate dispatches, so the whole edit is one undo step and one `selectionChange`.

## Decision 5: Event payload stays backward-compatible

`selectionChange` currently emits `{ anchor, head }` of the main range. The payload becomes `{ anchor, head, ranges, mainIndex }` — same object shape extended, so `({ anchor, head }) => ...` listeners keep working. `getSelection()` is untouched; `getSelections()` is the multi-range accessor.

## Decision 6: Table widget stays single-cell; only read-only checks widen

Multi-cursor inside contentEditable table cells is out of scope (cells are not CM selections). The two `selection.main` reads in `live-preview-table.ts` widen to all ranges:

- *Whole-table-selected overlay*: shown when **any** range fully covers the table source (`ranges.some(...)`).
- *Clear range selection when the cursor leaves the table*: only when **every** range head is outside the table span (`ranges.every(...)`) — a secondary cursor inside the table must keep the cell-range selection alive.

Both are pure condition widenings inside the existing rAF poll; no state lifecycle, locking, or DOM mutation changes (audited against the 12 table rules in `CLAUDE.md`).

## Testing strategy

- `multi-cursor.test.ts` (real `createEditor` in jsdom, as the existing suites do): config gating (off → multi-range `setSelections` collapses; on → preserved), all four commands incl. word-expansion / wrap-around / skip-selected / document-edge cases, per-range Enter and autopair behaviour, API + event payload.
- `live-preview-regressions.test.ts`: two cursors on two different bold spans → both reveal raw `**` markers; collapse to elsewhere → both hidden again. Guards the `.some()`-based reveal logic against future "optimise to main range" regressions.
- `markdown-keymap.test.ts`: existing single-cursor cases unchanged (behaviour lock), new multi-range cases.
