# Change: Standardize Widget API with Interaction Guards

## Why

The current `WidgetDefinition` interface is minimal: `nodeType`, `match?`, `render`, `destroy?`, `block?`, `ignoreEvents?`. This leaves all interaction complexity to widget authors, who must independently discover and solve the same class of bugs documented in `CLAUDE.md` §"Table Widget Development Rules" (12 rules). The table widget alone is 1500+ lines, with most of that complexity devoted to interaction guards that should be reusable infrastructure.

**Core problem**: When a widget renders interactive content (editable cells, checkboxes, drag handles), CM6's default behavior destroys and recreates the widget DOM mid-interaction. This causes:
- Event listeners pointing at detached nodes
- Selection state loss during drag
- Race conditions between focus/blur and widget rebuilds

The table widget solves this with a manual `tableEditingCount` counter and per-lock state tracking. Every new interactive widget must re-derive this pattern from scratch.

## What Changes

### 1. Add `InteractionGuard` to `WidgetDefinition`

```typescript
export interface WidgetDefinition {
  // ... existing fields ...

  /**
   * Declares which interaction types this widget needs protection for.
   * When any guard is active, the widget's StateField skips decoration
   * rebuilds and uses `decos.map(tr.changes)` instead.
   */
  interactionGuards?: InteractionGuard[];
}

export type InteractionGuardType = 'focus' | 'drag' | 'range';

export interface InteractionGuard {
  type: InteractionGuardType;
  /** Called when the guard should be acquired (e.g., mousedown). */
  acquire: (dom: HTMLElement) => void;
  /** Called when the guard should be released (e.g., mouseup). */
  release: (dom: HTMLElement) => void;
}
```

### 2. Centralized `WidgetInteractionState`

A new `StateField` in `widget-extension.ts` that tracks active guards across all widgets:

```typescript
interface WidgetInteractionState {
  activeGuards: Map<string, Set<InteractionGuardType>>;
}
```

When any guard is active for a widget, the `StateField.update` method uses `decos.map(tr.changes)` instead of rebuilding decorations. This prevents CM6 from recreating the widget DOM mid-interaction.

### 3. `WidgetRenderContext` enhancements

Add `acquireGuard(type)` and `releaseGuard(type)` to `WidgetRenderContext` so widget authors can manage guards from their render functions without external state:

```typescript
export interface WidgetRenderContext {
  // ... existing fields ...
  acquireGuard: (type: InteractionGuardType) => void;
  releaseGuard: (type: InteractionGuardType) => void;
}
```

### 4. Migrate table widget to use `InteractionGuard`

Refactor `EditableTableWidget` to declare its guards via the new API instead of manual `tableEditingCount` management. This reduces the table widget's complexity and serves as a validation of the API design.

## Impact

- Affected specs:
  - `editor-core` (MODIFIED — WidgetDefinition, WidgetRenderContext, widget-extension)
- Affected code:
  - `packages/core/src/types.ts` (WidgetDefinition, WidgetRenderContext)
  - `packages/core/src/widget-extension.ts` (InteractionGuard, WidgetInteractionState)
  - `packages/core/src/live-preview-table.ts` (migrate to InteractionGuard)
  - `packages/core/test/widgets.test.ts` (extend)
- No breaking changes: existing `WidgetDefinition` without `interactionGuards` keeps current behavior.
