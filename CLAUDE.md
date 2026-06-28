## Superpowers

- Superpowers is installed for Codex on this machine via `~/.agents/skills/superpowers`.
- If the current runtime can access those skills, prefer the relevant Superpowers workflow for planning, debugging, code review, and execution.
- OpenSpec 1.5 uses agent skills instead of `openspec/AGENTS.md`; use the repo-local `.claude/skills/openspec-*` workflows, `/opsx:*` commands, and `openspec/config.yaml` as the source of truth for spec-driven changes.

## Table Widget Development Rules

When modifying `packages/core/src/live-preview-table.ts`:

1. **Never clear state that was just set in the same flow.** If a function sets `rangeStart`, don't call another function that nullifies it before the value is used. Trace the full lifecycle (mousedown → mousemove → mouseup) before changing cleanup logic.

2. **rAF polling must respect all active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`. Missing any one causes the "works then immediately breaks" pattern.

3. **Never use inline border styles for drag indicators.** Use `box-shadow` or absolute-positioned overlay divs. Setting `border*` on table cells destroys structural borders on cleanup.

4. **`contentEditable` must be off by default on table cells.** Only activate on mousedown→focus, deactivate on blur. Otherwise browser text selection enters cells from outside.

5. **HTML5 Drag API is forbidden for table grips.** Use mousedown/mousemove/mouseup custom drag. HTML5 drag creates uncontrollable ghost images and can't be constrained to the table.

6. **Column grip pills must be positioned relative to header cells** (via absolute overlay or inline in header), NOT in a separate `<tr>` row — separate rows don't align with content column widths.

7. **Test every change with ALL interaction paths:** click-to-edit, drag-to-select-range, grip-click-to-select-column, grip-drag-to-reorder, click-outside-to-deselect, delete-key-on-selection.

8. **Any mouse interaction that spans multiple frames MUST set `self.editing = true` and increment `tableEditingCount`.** This prevents CM6 from recreating the widget DOM mid-interaction (via `eq()` returning true). Release in the mouseup handler. Without this, CM6 may destroy the DOM between mousedown and mousemove, leaving event listeners pointing at detached nodes.

9. **Cell `blur` handlers MUST check for active grip drag before clearing `editing`.** When user clicks a grip while a cell is focused, the event order is: grip mousedown (sets editing=true) → cell blur (async, would clear editing=false). The blur handler must guard with `if (draggingCol < 0 && draggingRow < 0)` before decrementing. Without this guard, drag works only when no cell was previously focused.

10. **`onDragEnd` MUST release editing lock BEFORE dispatching moveColumn/moveRow.** If editing=true during dispatch, the StateField takes the `decos.map` path (preserves old DOM), so the column move updates the markdown but the widget still shows old order. Correct order: (1) clean up visual state, (2) reset drag flags, (3) `self.editing = false; tableEditingCount--`, (4) dispatch move.

11. **rAF polling must respect ALL active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`, AND `rangeActive`. The `rangeActive` flag persists after mouseup for multi-cell selections — it is only cleared by explicit actions (`clearRangeSelection`). Missing this flag causes range selection to vanish on the next animation frame.

12. **StateField update must skip ALL rebuilds during `isTableEditing()`.** Both `docChanged` and selection-only changes. For docChanged use `decos.map(tr.changes)`, for selection-only return existing decos unchanged. If you only guard docChanged, selection changes during editing will trigger a full rebuild that recreates the widget DOM.
