# Design — Widget API Standardization

## Context

The widget system (`widget-extension.ts`) renders AST nodes as replacement decorations. When the user's selection intersects a widget's range, the decoration is removed and the raw markdown is shown instead (edit mode). This works well for read-only widgets (math blocks, mermaid diagrams) but breaks down for interactive widgets.

The table widget (`live-preview-table.ts`, 1500+ lines) has 12 documented rules for handling interactions. These rules are specific to the table widget but the underlying problems are generic:

1. **DOM destruction mid-interaction**: CM6 rebuilds decorations on every transaction. If a widget is mid-drag, the rebuild destroys the DOM node and all attached event listeners.
2. **State loss**: Widget-local state (drag position, editing cursor) is lost when the DOM is recreated.
3. **Race conditions**: Focus/blur events fire asynchronously and can conflict with widget rebuild timing.

## Goals / Non-Goals

### Goals
- Provide a declarative way for widgets to protect interactions from DOM rebuilds
- Centralize the "skip rebuild during interaction" logic in `widget-extension.ts`
- Reduce the table widget's complexity by migrating to the new API
- Make it safe for third-party widgets to add interactive content

### Non-Goals
- Replacing CM6's widget system entirely (we wrap it, not replace it)
- Supporting widgets that modify the document during interaction (that's a separate concern)
- Mobile/touch interaction guards (desktop only for now)

## Decisions

### Decision 1: Declarative guards vs. imperative callbacks

**Adopted**: Declarative `InteractionGuard` array on `WidgetDefinition`.

**Rationale**: 
- The table widget's 12 rules are all about when to skip decoration rebuilds. This is a cross-cutting concern that belongs in the framework, not in each widget.
- Declarative guards let the framework manage the lifecycle (acquire on mousedown, release on mouseup/blur) without widget authors writing boilerplate.
- The `acquire`/`release` callbacks are still imperative, so widgets retain full control over their DOM.

**Alternative considered**: A single `isInteracting()` callback on `WidgetDefinition`. Rejected: doesn't distinguish between interaction types (focus vs. drag vs. range), which matters for the table widget's lock-based system.

### Decision 2: Where does the "skip rebuild" logic live?

**Adopted**: In `widget-extension.ts`'s `StateField.update`, checking `WidgetInteractionState`.

**Rationale**: The StateField is the single place where decoration rebuilds are triggered. Moving the guard check here means:
- One implementation, not N (one per widget)
- The check is O(active guards), which is typically 0-1
- The `decos.map(tr.changes)` path is already proven (used by the table widget today)

**Alternative considered**: Each widget's `eq()` method returns `true` during interactions. Rejected: `eq()` is called per-widget, so the guard logic would be duplicated. Also, `eq()` controls whether the widget is *replaced*, not whether decorations are *rebuilt*.

### Decision 3: How are guards acquired/released?

**Adopted**: `acquireGuard(type)` / `releaseGuard(type)` on `WidgetRenderContext`, called from the widget's render function.

**Rationale**: The widget's render function creates the DOM and attaches event listeners. It's the natural place to wire up guard acquisition (on mousedown) and release (on mouseup/blur). The context is already passed to `render()`, so no new API surface is needed.

**Alternative considered**: Automatic guard acquisition via CSS classes or data attributes. Rejected: too implicit, hard to debug, doesn't work for complex interactions like drag-and-drop.

### Decision 4: InteractionGuard type taxonomy

**Adopted**: Three types: `focus`, `drag`, `range`.

**Rationale**: These map directly to the table widget's three editing locks:
- `focus`: User is editing a cell (contentEditable)
- `drag`: User is dragging a column/row grip
- `range`: User is selecting a range of cells

Other widget types might only need `focus` (e.g., a checkbox widget) or `drag` (e.g., a resizable image). The taxonomy is extensible—new types can be added without breaking existing guards.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Guard leak (acquire without release) | `WidgetInteractionState` tracks guards per-widget; the `destroy` method releases all guards for a destroyed widget |
| Performance overhead of checking guards on every transaction | The check is `Map.has()` × active guard count, which is O(1) in practice |
| Table widget migration breaks existing behavior | Migration is incremental; the old `tableEditingCount` can coexist with the new guards during transition |

## Migration Plan

1. Add `InteractionGuard` and `WidgetRenderContext` extensions (no breaking changes)
2. Add `WidgetInteractionState` StateField
3. Migrate table widget's `focus` lock to `InteractionGuard`
4. Migrate table widget's `drag` lock to `InteractionGuard`
5. Migrate table widget's `range` lock to `InteractionGuard`
6. Remove `tableEditingCount` once all locks are migrated

Each step is a separate commit. Steps 3-5 can be done incrementally.

## Open Questions

- Should guards be per-widget-instance or per-widget-definition? (Currently per-instance, which seems right)
- Should the framework auto-release guards on blur? (Yes, for `focus` type; `drag` and `range` should be released on mouseup)
