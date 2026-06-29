## 1. Core Public API

- [x] 1.1 Add `WidgetDisplayMode = "block" | "inline"` and `WidgetEventPolicy = "editor" | "widget"` public types in `packages/core/src/types.ts`.
- [x] 1.2 Extend `WidgetDefinition` with optional `display?: WidgetDisplayMode` and `eventPolicy?: WidgetEventPolicy` fields.
- [x] 1.3 Keep `block?: boolean` and `ignoreEvents?: boolean` on `WidgetDefinition` with JSDoc marking them as legacy-compatible aliases, not removed fields.
- [x] 1.4 Add a `WidgetSourceRange` type and extend `WidgetRenderContext` with `range` and `enterEditMode(position?: "start" | "end")`. (The document-mutating `replaceSource` helper and the numeric `enterEditMode(number)` form are deferred to a follow-up — see `design.md`.)
- [x] 1.5 Keep `WidgetRenderContext.from`, `to`, `setSelection`, and `focus` available for existing render functions.
- [x] 1.6 Export any newly introduced public widget types from `packages/core/src/index.ts`.

## 2. Core Widget Extension

- [x] 2.1 Add local normalization helpers in `packages/core/src/widget-extension.ts` for canonical `display` and `eventPolicy` resolution that validate against the known value sets (`"block" | "inline"`, `"widget" | "editor"`) and fall back to the legacy/default branch for unrecognized values (do not use `??`, which only catches `null`/`undefined`).
- [x] 2.2 Update decoration creation so `display` controls `Decoration.replace({ block })`, with fallback to legacy `block !== false`.
- [x] 2.3 Update `NexusWidget.ignoreEvent()` so `eventPolicy` controls event ownership, with fallback to legacy `ignoreEvents === true`.
- [x] 2.4 Populate `ctx.range` with `{ from, to, source }` while preserving legacy `ctx.from` and `ctx.to`.
- [x] 2.5 Implement `ctx.enterEditMode("start" | "end")` so it dispatches the selection to the source-range start (default) or end, focuses the editor, and reveals raw Markdown. Route the dispatch through the same position clamp as `ctx.setSelection` (clamp to `[0, doc.length]`) so a stale captured offset is clamped rather than throwing `RangeError`.
- [x] 2.6 Preserve existing behavior when no widgets are registered: `createWidgetExtension()` still returns `[]`.

## 3. Core Tests

- [x] 3.1 Extend `packages/core/test/widgets.test.ts` for `display: "inline"` and default block behavior, and assert the core-applied `data-nexus-widget` attribute is present on a rendered widget.
- [x] 3.2 Add tests for `eventPolicy: "widget"` and `eventPolicy: "editor"` mapping to CodeMirror event ownership.
- [x] 3.3 Add tests proving legacy `block: false` and `ignoreEvents: true` still work.
- [x] 3.4 Add tests proving canonical `display` and `eventPolicy` override conflicting legacy aliases.
- [x] 3.5 Add tests for `ctx.range`, legacy `ctx.from`/`ctx.to`, and legacy `ctx.setSelection`/`ctx.focus`.
- [x] 3.6 Add tests for `ctx.enterEditMode()` default (start) and `"end"` behavior.
- [x] 3.7 Keep or extend existing tests for selection intersection reveal, `destroy()`, multiple plugin widgets, live-preview coexistence, and no-widget behavior.
- [x] 3.8 Add a test proving an unrecognized `display` / `eventPolicy` value (e.g. a value from a newer core) falls back to the legacy/default branch and does not throw.

## 4. Math Plugin Reference Migration

- [x] 4.1 Update `packages/plugin-math/src/index.ts` block math widget to use `display: "block"` and `eventPolicy: "widget"`.
- [x] 4.2 Update the block math edit affordance to call `ctx.enterEditMode()` instead of manually calling `ctx.setSelection(ctx.from)` and `ctx.focus()`.
- [x] 4.3 Update inline math widget to use `display: "inline"` and `eventPolicy: "editor"`.
- [x] 4.4 Add focused math plugin tests or core integration tests proving block math renders, inline math remains inline, and block edit affordance reveals raw Markdown.

## 5. Documentation and Roadmap

- [x] 5.1 Update top-level `README.md` and `README.zh.md` plugin authoring examples to use `display`, `eventPolicy`, and context helpers.
- [x] 5.2 Add a Widget API section to `packages/core/README.md` documenting `display`, `eventPolicy`, `ctx.range`, and `ctx.enterEditMode()`, and noting that `display: "block"` requires whole-line ranges (inline / partial-line nodes use `display: "inline"`).
- [x] 5.3 Document `block` and `ignoreEvents` as legacy-compatible aliases in public docs/JSDoc.
- [x] 5.4 Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md` row #9 to reference `openspec/changes/standardize-widget-api` and move status to `in-progress` during implementation.

## 6. Verification

- [x] 6.1 `openspec validate standardize-widget-api --strict` passes.
- [x] 6.2 Focused tests pass: `pnpm exec vitest run packages/core/test/widgets.test.ts`.
- [x] 6.3 Math plugin focused tests pass if added.
- [x] 6.4 `pnpm typecheck` passes.
- [x] 6.5 `pnpm test` passes.
- [x] 6.6 `pnpm build` passes.
- [x] 6.7 `pnpm build:electron-demo` passes.
- [x] 6.8 Manual smoke: temporarily register `createMathPlugin()` in an electron-demo local run, open Markdown with both block and inline math, verify block edit affordance reveals raw source and inline math stays in paragraph flow, then remove temporary demo wiring before commit unless permanent demo integration is intentionally added.
