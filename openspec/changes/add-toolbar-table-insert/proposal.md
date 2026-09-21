# Change: Add Table Insertion to the Toolbar

## Why

Roadmap item **#12 — advanced toolbar (emoji picker / table tools / color picker), `plugin-toolbar`, P2** is planned but unstarted. The color picker half already shipped; the table half has no entry point at all.

The engine can already *edit* tables: `packages/core/src/live-preview-table.ts` renders an interactive grid with cell editing, range selection, row/column reordering and resize. What is missing is the way **in** — a host that wants a table has to hand-write the GFM delimiter row and get the pipe alignment right. That is exactly the kind of syntax a toolbar exists to spare the user, and it is the one block type the toolbar cannot currently produce.

## What Changes

- Add `insertTable(editor, rows, cols)`: inserts a GFM table with a header row plus `rows - 1` body rows, in a single transaction so one undo removes the whole table.
- Count the **header as the first row**, matching the shape the picker draws — a `2 x 3` pick is a three-column table with one body row.
- Keep the table separated from surrounding text by blank lines when it does not already land on its own line.
- Add a size-picker dropdown to the toolbar: a 6 x 6 grid where hovering grows the highlight and updates a live `N x M` readout, and clicking inserts that size.
- Add an `iconTable` pictographic icon matching the existing icon set.
- Reuse the existing dropdown machinery (`DROPDOWN_STYLES`, `DROPDOWN_IDS`, the outside-click handler, `closeDropdown`) rather than introducing a second overlay path.
- Export `insertTable` from the package entry point.

## Non-Goals

- No table *editing* commands (add/remove row or column, alignment, delete table). `live-preview-table.ts` already owns table manipulation; a second implementation would duplicate it.
- No HTML tables, captions, or column widths — the document stays GFM.
- No emoji picker. Roadmap #12 covers both, but color shipped alone and this change follows that precedent; emoji is a separate proposal.
- No change to `packages/core/**`, `packages/plugin-slash/**`, or `packages/plugin-toolbar/src/color-decoration.ts`.
- No new dependencies.

## Impact

- Affected specs: `plugin-toolbar`
- Affected code:
  - `packages/plugin-toolbar/src/formatting.ts` (`insertTable`)
  - `packages/plugin-toolbar/src/toolbar-ui.ts` (size picker, button wiring)
  - `packages/plugin-toolbar/src/icons.ts` (`iconTable`)
  - `packages/plugin-toolbar/src/index.ts` (export)
  - `packages/plugin-toolbar/test/plugin-toolbar.test.ts`
- Explicitly out of scope:
  - `packages/core/**`
  - `packages/plugin-slash/**`
