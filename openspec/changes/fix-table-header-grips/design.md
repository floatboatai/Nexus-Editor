## Context

`EditableTableWidget` currently creates a separate `gripRow` before rendering the table header. Width measurement, row-selection indexing, and hover visibility rely on that synthetic row. A separate row cannot reliably align its grip cells to the rendered content columns.

## Decision

Each header cell will own one `.nexus-col-grip` overlay. The grip uses the existing custom `mousedown` / document `mousemove` / document `mouseup` drag path and stays separate from the resize handle's hit target. Header hover controls grip visibility; drag start hides the header grips and drag end leaves them hidden until the next header hover.

Table row access will be semantic: header cells come from the header row and body rows are selected by their data-cell role, rather than by an assumed row offset.

## Non-Goals

- Change column resize behavior or persisted widths.
- Change row reordering, range selection, cell editing, or Markdown output.
- Add public APIs, dependencies, or Electron-only behavior.

## Risks and Mitigations

- Moving grips changes table row indexing. Replace each affected numeric lookup and cover column selection and row drag in regression tests.
- Grip overlays can intercept cell interaction. Keep their hit area limited, stop propagation only for grip events, and retain the existing resize handle's higher z-index.
- Multi-frame mouse interaction can trigger CodeMirror widget replacement. Reuse the existing drag editing lock and verify it is released before dispatch.
