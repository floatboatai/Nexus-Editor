## Context

Nexus widgets are currently registered through `NexusPlugin.widgets` and rendered by `packages/core/src/widget-extension.ts` as CodeMirror `Decoration.replace` widgets over mdast source ranges. The existing API is intentionally small, but its public surface still exposes implementation-shaped fields:

- `block?: boolean` controls CodeMirror block decoration behavior.
- `ignoreEvents?: boolean` controls `WidgetType.ignoreEvent()`.
- `WidgetRenderContext` exposes only `from`, `to`, `setSelection`, and `focus`, so interactive widgets must hand-roll edit-mode entry.

This is enough for `@floatboat/nexus-plugin-math`, but it is weak as a long-term plugin contract. Roadmap #9 requires standardizing the Widget API before more widget-backed plugins are added.

## Goals / Non-Goals

**Goals:**

- Add a clearer public widget contract while keeping existing widgets working.
- Replace implementation-shaped booleans with named policy fields:
  - `display?: "block" | "inline"`
  - `eventPolicy?: "editor" | "widget"`
- Extend `WidgetRenderContext` with `range` and `enterEditMode("start" | "end")` helpers (the document-mutating `replaceSource` helper and the numeric `enterEditMode(number)` form are deferred — see Decisions).
- Migrate `@floatboat/nexus-plugin-math` to the standardized fields and helpers as the reference plugin.
- Keep Markdown text as the source of truth and preserve raw-source reveal when selection intersects a widget range.
- Cover legacy compatibility and new API behavior with focused jsdom/Vitest tests.

**Non-Goals:**

- No rewrite of `packages/core/src/live-preview-table.ts`.
- No new Mermaid package in this PR.
- No React/Vue portal API for framework-rendered widgets.
- No widget hot reload, plugin event bus, or async widget scheduler.
- No breaking removal of `block`, `ignoreEvents`, `from`, `to`, `setSelection`, or `focus`.
- No generic per-node typing of widget `match` / `render` — `node` stays `any` in this PR; the "typed" contract refers to the definition and context field types, not mdast node generics.
- No document-mutating context helper (`replaceSource`) or numeric `enterEditMode(number)` in this PR — deferred until a widget that rewrites its own source exists (see Decisions).

## Decisions

### Decision: Standardize by extending `WidgetDefinition`, not by introducing a separate v2 registry

Keep `NexusPlugin.widgets?: WidgetDefinition[]` as the registration point and add canonical fields to the existing interface. Existing plugins keep compiling, and new plugins can adopt the clearer fields incrementally.

Alternative considered: add `widgetsV2` or `defineWidget()`. Rejected for this PR because it creates two registration paths and forces plugin authors to choose between them before the existing contract has actually broken.

### Decision: Canonical fields override legacy aliases

`display` is canonical. When present, it determines block vs inline decoration. If omitted, the adapter falls back to `block !== false`, preserving current behavior.

`eventPolicy` is canonical. When present, `"widget"` maps to `ignoreEvent() === true` and `"editor"` maps to `false`. If omitted, the adapter falls back to `ignoreEvents === true`. For the record, `eventPolicy: "widget"` is equivalent to legacy `ignoreEvents: true` (the editor does not receive events) and `eventPolicy: "editor"` is equivalent to `ignoreEvents: false`.

Unrecognized or invalid canonical values (for example a `display` value a future core version introduces but an older core does not know) are treated as if the field were absent — the adapter uses the legacy/default branch rather than silently coercing to inline/editor — and never throw. This keeps the contract forward-compatible across core versions.

This makes mixed definitions deterministic and lets docs recommend only the new fields.

### Decision: Keep context helpers editor-facing, not CM6-facing

The render context adds:

- `range: { from: number; to: number; source: string }`
- `enterEditMode(position?: "start" | "end"): void`

(The document-mutating `replaceSource` helper and the numeric `enterEditMode(number)` form are deferred — see the deferral decision below.)

The context still exposes `from`, `to`, `setSelection`, and `focus` for compatibility, but it does not expose `EditorView`. This keeps plugin code on the stable Nexus surface and avoids locking public widgets to CodeMirror internals.

Alternative considered: expose `EditorView` or the full `EditorAPI` from context. Rejected for now because widgets only need source-range editing primitives for this PR; lower-level access can be revisited with a broader plugin API proposal.

### Decision: Implement legacy adaptation inside core widget extension

`widget-extension.ts` should normalize each definition before using it:

```text
display = (definition.display === "block" || definition.display === "inline")
  ? definition.display
  : (definition.block === false ? "inline" : "block")
eventPolicy = (definition.eventPolicy === "widget" || definition.eventPolicy === "editor")
  ? definition.eventPolicy
  : (definition.ignoreEvents === true ? "widget" : "editor")
```

This keeps behavior in one place and avoids duplicating compatibility logic across plugins.

### Decision: Defer `replaceSource` and the numeric `enterEditMode` form to a follow-up

Document-mutating helpers are deferred until a real consumer exists. This PR has no widget that rewrites its own source — the math reference and the only imminent widget plugin (Mermaid, render-only) need just `display`, `eventPolicy`, `range`, and `enterEditMode("start" | "end")`.

Deferring avoids freezing two contracts with no consumer to validate them:

- `replaceSource(markdown, selection?)` — mutates the document over the widget's source range. Its selection-coordinate semantics are unsettled (absolute post-change vs range-relative), and dispatching off a render-time-captured range is unsafe while the range can shift under the IME-composition `decos.map` path in `widget-extension.ts`, where the cached `from`/`to` are not refreshed. A future implementation MUST re-resolve the live range via the existing `EditorAPI.getPosAtDOM` (already on the public surface) at dispatch time rather than trusting captured offsets.
- numeric `enterEditMode(number)` — its coordinate frame (absolute vs range-relative) has no consumer to pin it, and an absolute offset outside the widget range would move the cursor away without entering edit mode. Like `replaceSource`, the reintroduced form MUST re-resolve the live range via `getPosAtDOM` rather than the captured offsets.

The kept `enterEditMode("start" | "end")` reads the same captured range but only *moves the selection*: a stale offset there at worst misplaces the cursor (clamped to document bounds and self-correcting on the next rebuild — identical to today's legacy `setSelection(ctx.from)` path), whereas a stale offset in a document *mutation* would overwrite the wrong text. That asymmetry is why selection-only entry ships now while mutation defers.

When reintroduced, both deferred forms SHALL use **range-relative** offsets (measured from the source-range start, clamped to the source length), honoring this proposal's goal of not forcing plugins to recalculate document offsets. Each un-defers on its own validating consumer, not as a bundle: `replaceSource` requires an in-tree consumer that rewrites its own source (e.g. a task-list / checkbox-toggle plugin), and numeric `enterEditMode(number)` requires a consumer that needs an intra-range cursor offset. A render-only plugin such as Mermaid validates neither, so it triggers neither un-deferral.

## Risks / Trade-offs

- **Risk: API naming still has to last.** Mitigation: keep the new surface deliberately small and policy-based; do not add renderer-specific concepts in this PR.
- **Risk: mixed old/new fields create surprising behavior.** Mitigation: document and test that canonical fields win over legacy aliases.
- **Risk: `eventPolicy` collapses CM6's per-event `ignoreEvent(event)` into an all-or-nothing flag.** Even the math reference's edit button must `preventDefault()` / `stopPropagation()` to escape its own `"widget"` swallow. Accepted for this PR; if per-event ownership is ever needed, `eventPolicy` can widen to also accept a predicate, which is additive and non-breaking.
- **Risk: `display: "block"` over a non-line-aligned (inline / partial-line) range makes CodeMirror throw.** Mitigation: document that `display: "block"` is only valid for ranges that span whole lines (the existing block default already behaves this way for block nodes); inline node types must use `display: "inline"`. This is left as documentation rather than a runtime guard: the constraint already holds for legacy `block: true` today (the field adds no new failure mode), it fails loudly in development, and no in-PR widget triggers it; a per-widget try/catch fallback to inline can be added later if third-party misconfiguration proves common. The asymmetry with the never-throw handling of unknown *values* is deliberate — an unknown value is a silent-by-nature forward-compat case, whereas a wrong-geometry block is a loud author error best surfaced, not swallowed.
- **Risk: widget events can still be confusing.** Mitigation: rename the policy to ownership language (`editor` vs `widget`) and migrate math examples.
- **Risk: live-preview/table interaction regressions.** Mitigation: do not touch table widget internals; keep widget-extension tests focused and run the full validation matrix.

## Migration Plan

1. Add the new TypeScript types and fields in `packages/core/src/types.ts`.
2. Normalize legacy and canonical fields inside `packages/core/src/widget-extension.ts`.
3. Extend render context helpers without removing legacy properties.
4. Update widget tests to cover both old and new APIs.
5. Migrate `@floatboat/nexus-plugin-math` to `display`, `eventPolicy`, and `enterEditMode`.
6. Update README/core docs and mark roadmap row #9 in progress during implementation.

Rollback is straightforward before the first published release: because the change is additive, reverting the implementation restores the old behavior without data migration. Once these fields ship in a published `@floatboat/nexus-core` and a downstream plugin adopts them, the surface is effectively frozen — removing a field becomes a breaking change. That post-publish lock-in is the main reason this PR keeps the new surface minimal and defers unproven helpers.

## Open Questions

- Should future widget APIs support framework portals or async renderers? Out of scope for this PR.
- Which interactive widget (task-list / checkbox) lands as the first consumer of the deferred `replaceSource` / numeric `enterEditMode` follow-up? (The follow-up's offset model — range-relative offsets with `getPosAtDOM` re-resolution — is already decided under Decisions.)
