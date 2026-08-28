<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Superpowers

- Superpowers is installed for Codex on this machine via `~/.agents/skills/superpowers`.
- If the current runtime can access those skills, prefer the relevant Superpowers workflow for planning, debugging, code review, and execution.
- Keep OpenSpec instructions as the source of truth for spec-driven changes in this project.

## Table Widget Development Rules

When modifying `packages/core/src/live-preview-table.ts`:

1. **Never clear state that was just set in the same flow.** If a function sets `rangeStart`, don't call another function that nullifies it before the value is used. Trace the full lifecycle (mousedown → mousemove → mouseup) before changing cleanup logic.

2. **rAF polling must respect all active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`. Missing any one causes the "works then immediately breaks" pattern.

3. **Never use inline border styles for drag indicators.** Use `box-shadow` or absolute-positioned overlay divs. Setting `border*` on table cells destroys structural borders on cleanup.

4. **`contentEditable` must be off by default on table cells.** Only activate on mousedown→focus, deactivate on blur. Otherwise browser text selection enters cells from outside.

5. **HTML5 Drag API is forbidden for table grips.** Use mousedown/mousemove/mouseup custom drag. HTML5 drag creates uncontrollable ghost images and can't be constrained to the table.

6. **Column grip pills live in a dedicated `<tr>` inside the same `<table>`** (matching spacer + one cell per content column) so table layout keeps them aligned with content widths. Do not put grips in a *separate* table or a non-table overlay that cannot follow `colgroup` widths.

7. **Test every change with ALL interaction paths:** click-to-edit, drag-to-select-range, grip-click-to-select-column, grip-drag-to-reorder, click-outside-to-deselect, delete-key-on-selection. Delete/paste on a **cell range** must assert both markdown **and** cell DOM — document-only assertions miss stale-widget bugs.

8. **Any mouse interaction that spans multiple frames MUST set `self.editing = true` and increment `tableEditingCount` (now `beginWidgetInteraction`).** This prevents CM6 from recreating the widget DOM mid-interaction (via `eq()` returning true). Release in the mouseup handler for drags and single-cell clicks. **Exception:** a persistent multi-cell range (`rangeActive`) keeps the lock until `clearRangeSelection` (outside click, Delete, paste, or a new gesture). Outside-click MUST be `addEventListener("mousedown", fn, true)` on `document` — mermaid and other table cells `stopPropagation` on mousedown, so a bubble listener never runs and the range lock sticks.

9. **Cell `blur` handlers MUST check for active grip drag before clearing `editing`.** When user clicks a grip while a cell is focused, the event order is: grip mousedown (sets editing=true) → cell blur (async, would clear editing=false). The blur handler must guard with `if (draggingCol < 0 && draggingRow < 0)` before decrementing. Without this guard, drag works only when no cell was previously focused.

10. **Release the editing lock BEFORE any `dispatch` that should rebuild the table** (`onDragEnd` moveColumn/moveRow, Delete/Backspace on a cell range, paste into a cell range). If the lock is held during dispatch, the StateField takes the `decos.map` path (preserves old DOM), so markdown updates but cells still show the previous values. Correct order: (1) clean up visual state, (2) reset drag/range flags and `clearRangeSelection()`, (3) `self.editing = false; tableEditingCount--`, (4) dispatch.

11. **rAF polling must respect ALL active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`, AND `rangeActive`. The `rangeActive` flag persists after mouseup for multi-cell selections — it is only cleared by explicit actions (`clearRangeSelection`). Missing this flag causes range selection to vanish on the next animation frame.

12. **StateField update must skip ALL rebuilds during `isWidgetInteracting()` (alias: `isTableEditing()`).** Both `docChanged` and selection-only changes. For docChanged use `decos.map(tr.changes)`, for selection-only return existing decos unchanged. If you only guard docChanged, selection changes during editing will trigger a full rebuild that recreates the widget DOM.
