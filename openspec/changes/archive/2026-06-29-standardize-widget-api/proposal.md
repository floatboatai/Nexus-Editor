## Why

Roadmap #9 calls out Widget API standardization before we build more widget-backed plugins. The current public widget contract works for early math rendering, but plugin authors must rely on low-level fields such as `block`, `ignoreEvents`, and manual `ctx.setSelection(ctx.from)` patterns that are easy to misuse and hard to extend.

## What Changes

- Add a stable, typed widget API contract for `@floatboat/nexus-core` plugin authors.
- Introduce explicit widget display and event policy fields while preserving the existing `block` and `ignoreEvents` behavior as legacy-compatible aliases.
- Extend the render context with higher-level helpers for source range access and entering edit mode, so interactive widgets do not need to duplicate cursor/focus boilerplate.
- Keep Markdown as the source of truth: widgets continue to render from mdast ranges and reveal raw Markdown when the selection intersects the source range.
- Migrate `@floatboat/nexus-plugin-math` to the standardized API as the reference plugin.
- Update public documentation and examples for top-level README, core README, and plugin authoring guidance.
- No breaking changes in this PR; existing `WidgetDefinition` users continue to work.

## Capabilities

### New Capabilities

- `widget-api`: Public plugin widget contract for matching mdast nodes, rendering block/inline widgets, event ownership, edit-mode entry, lifecycle cleanup, and legacy compatibility.

### Modified Capabilities

- None.

## Impact

- Affected roadmap item: `docs/ROADMAP.md` row #9, "Widget API standardization".
- Affected packages:
  - `@floatboat/nexus-core`: public TypeScript API, widget extension behavior, exports, docs, and tests.
  - `@floatboat/nexus-plugin-math`: migrate to the standardized widget API as a real plugin proof.
- Public API impact: additive public API; legacy widget fields remain supported.
- Behavior impact: widget rendering behavior should remain compatible for existing plugins, with new behavior covered by focused tests.
- Tooling/dependency impact: no new runtime dependency expected.
