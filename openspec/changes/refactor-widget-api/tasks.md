# Implementation Tasks

## 1. Types — Extend WidgetDefinition and WidgetRenderContext

- [ ] 1.1 Add `InteractionGuardType`, `InteractionGuard` interfaces to `packages/core/src/types.ts`
- [ ] 1.2 Add `interactionGuards?: InteractionGuard[]` to `WidgetDefinition`
- [ ] 1.3 Add `acquireGuard(type)` and `releaseGuard(type)` to `WidgetRenderContext`

## 2. Core — WidgetInteractionState and guard-aware rebuild

- [ ] 2.1 Add `WidgetInteractionState` StateField to `packages/core/src/widget-extension.ts`
- [ ] 2.2 Modify `StateField.update` to check `WidgetInteractionState` and use `decos.map(tr.changes)` when any guard is active
- [ ] 2.3 Wire `acquireGuard`/`releaseGuard` into `NexusWidget.toDOM()` context
- [ ] 2.4 Auto-release all guards for a widget in `NexusWidget.destroy()`

## 3. Tests — Widget interaction guards

- [ ] 3.1 Add tests in `packages/core/test/widgets.test.ts` for:
  - Widget with `focus` guard: DOM preserved during focus
  - Widget with `drag` guard: DOM preserved during drag
  - Widget without guards: current behavior unchanged
  - Guard leak prevention: destroy releases all guards

## 4. Migration — Table widget to InteractionGuard

- [ ] 4.1 Migrate `focus` lock in `live-preview-table.ts` to `InteractionGuard`
- [ ] 4.2 Migrate `drag` lock to `InteractionGuard`
- [ ] 4.3 Migrate `range` lock to `InteractionGuard`
- [ ] 4.4 Remove `tableEditingCount` and `isTableEditing()` once all locks migrated

## 5. Verify + Validate

- [ ] 5.1 `pnpm test` passes — all existing tests + new widget guard tests
- [ ] 5.2 `pnpm build` passes for `core`
- [ ] 5.3 Manually smoke-tested in electron-demo: table editing, drag, range selection all work
