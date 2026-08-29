## 1. Spec & docs
- [x] 1.1 Add OpenSpec change `add-list-item-drag-reorder`
- [x] 1.2 Mark `add-missing-features` task 2.4 done when implementation lands
- [x] 1.3 Note list drag in ROADMAP / PR description (no new roadmap row — covered by missing-features / live-preview)

## 2. Source transform
- [x] 2.1 Implement `reorderSiblingListItems(doc, items, fromIndex, toIndex)`
- [x] 2.2 Preserve nested child lines by moving each item's full `[from, nextFrom)` span
- [x] 2.3 Renumber ordered top-level markers after reorder
- [x] 2.4 Unit tests for flat, nested, ordered, task-list items

## 3. Live-preview UI
- [x] 3.1 List grip widget before each rendered item marker
- [x] 3.2 Custom drag with drop indicator (box-shadow / overlay, not border)
- [x] 3.3 Editing lock + `isListEditing` skip rebuild in StateField
- [x] 3.4 Release lock before dispatching the source change

## 4. Verification
- [x] 4.1 Vitest green for new + existing list live-preview tests
- [ ] 4.2 Manual: drag unordered / ordered / nested in electron-demo or vitest DOM
