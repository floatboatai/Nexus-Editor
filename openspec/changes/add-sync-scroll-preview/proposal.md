# Change: Add Sync-Scroll Preview Pane

## Why

Roadmap **#13 — Markdown live preview sync scroll (`core`, P2)** is still open. Nexus's live preview is inline-only (Obsidian-style, decorations inside the same CM6 view) — there is no rendered, read-only preview surface anywhere in the codebase, so "sync scroll" currently has nothing to scroll two of.

This proposal scopes roadmap #13 narrowly: a read-only rendered preview pane plus offset-based (not percentage-based) two-way scroll sync, and nothing else. Percentage scroll (`scrollTop / scrollHeight`) is a non-starter — Markdown blocks render at wildly different heights (a heading vs. a fenced code block vs. a table), so proportional math can't keep two panes visually aligned. The feature ships behind an opt-in demo toggle so no existing default behavior changes, and stays out of unrelated territory (no keybinding UI, no wiki-link rendering) to keep the change reviewable as one concern.

## What Changes

- **Core (`@floatboat/nexus-core`)**:
  - New `scroll` event on `EditorEventMap`: `{ offset: number; ratio: number }` — `offset` is the document character offset at the top of the visible viewport; `ratio` is the fractional scroll position within the rendered height of that offset's document line (a line-based unit — see design.md § "ratio computed in two incompatible units"). Backed by a `ViewPlugin` on `view.scrollDOM`'s native `scroll` event, rAF-throttled, computed via `view.lineBlockAtHeight(view.scrollDOM.scrollTop)` — a content-space CM6 API, no screen-coordinate math involved.
  - New `EditorAPI.scrollToOffset(offset: number, ratio?: number): void` — the write-side counterpart to the `scroll` event, so a host can drive the editor's scroll position from an external position (the preview pane, in this change). Implemented via `view.lineBlockAt(offset)` + setting `view.scrollDOM.scrollTop`, kept symmetric with the read side and avoiding any need to expose the CM6 `EditorView` itself to hosts.
  - New exported function `renderPreviewHtml(ast: Root): string` — converts an mdast tree (as returned by `editor.getAst()`) to an HTML string via the `remark-rehype` + `rehype-stringify` pipeline already used by `exportHTML()`, reusing the "transform an existing tree via `processor.runSync`" pattern already established by `createTransformProcessor` in `editor.ts` (no second parse pass). Every block-level element in the output is annotated with `data-offset="<mdast node start offset>"`.
  - No new runtime dependencies — `unified`, `remark-rehype`, `rehype-stringify` are already direct dependencies of `packages/core`.
- **Electron demo (`apps/electron-demo`)**:
  - New `preview-panel.ts` (same shape as `outline-panel.ts`): renders `renderPreviewHtml(editor.getAst())` into a read-only pane, re-rendering on `editor.on("change")`.
  - Two-way scroll binding: editor `scroll` event → nearest `[data-offset]` element in the preview pane is aligned to the top of the pane; preview pane's own scroll → nearest `[data-offset]` element's offset is resolved and passed to `editor.scrollToOffset()`. Both directions guarded by an `isSyncingScroll` flag (cleared two animation frames after a programmatic scroll — see design.md § "minor hardening and cleanup") to prevent feedback loops.
  - New toolbar toggle button via `setPreviewVisible`/`togglePreview` in `app.ts` — a small variant of the shared `togglePanel()` helper, since showing/hiding also persists `settings.splitPreview`, which `togglePanel`'s single `onShow` callback can't express. The shared helper itself now takes an explicit show-display value (see design.md § "shared `togglePanel()` bug fixed at the source"). Default **off**.
  - New `EditorSettings.splitPreview: boolean` (default `false`), following the existing `livePreview` toggle convention in `settings.ts`.
- **Explicit v1 limitation**: wiki-link (`[[...]]`) syntax is not a real mdast node — `wikilinks.ts` implements it via regex scan + CM6 decoration, not a remark node type. Verified against the actual Lezer-backed AST (not assumed): the outer bracket pair passes through as literal text, but the inner `[Target]` is parsed by `@lezer/markdown`'s CommonMark grammar as an unresolved shortcut-reference `Link` node, and `lezer-mdast-adapter.ts`'s `Link`/`Autolink`/`URL` case (a pre-existing, unrelated quirk — falls back to using the whole node's raw text as `href` when no `URL` child is found, a fallback meant for bare autolinks) gives it a garbage self-referential `href`. This is a pre-existing adapter bug, out of scope for this change — see `design.md` for the precise mechanism and a suggested standalone follow-up. Rendering wiki links properly in the static preview is left to a later change, to keep this PR to one concern.

## Impact

- Affected specs:
  - `editor-core` (ADDED — `scroll` event, `renderPreviewHtml` export)
  - `sync-scroll-preview` (ADDED — new capability: split preview pane, bidirectional offset-based scroll sync, demo wiring)
- Affected code:
  - `packages/core/src/editor.ts` (scroll `ViewPlugin`, wire into extensions, emit `scroll` event)
  - `packages/core/src/types.ts` (`EditorEventMap.scroll`)
  - `packages/core/src/live-preview-to-html.ts` (NEW — `renderPreviewHtml`)
  - `packages/core/src/lezer-mdast-adapter.ts` (two narrow spec-compliance fixes the preview depends on: `table.align` populated from the delimiter row instead of hardcoded `[]`, and task-list item text recovered into a paragraph child — see `design.md` § adapter emits non-spec mdast shapes)
  - `packages/core/src/index.ts` (export `renderPreviewHtml`)
  - `packages/core/test/scroll-event.test.ts` (NEW)
  - `packages/core/test/live-preview-to-html.test.ts` (NEW)
  - `apps/electron-demo/src/renderer/preview-panel.ts` (NEW)
  - `apps/electron-demo/src/renderer/app.ts` (mount panel, toolbar button)
  - `apps/electron-demo/src/renderer/settings.ts` (`splitPreview` toggle)
  - `apps/electron-demo/test/preview-panel.test.ts` (NEW — link-click safety regression guard)
  - `packages/core/README.md`, `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- New dependencies: none.
- Out of scope (explicit non-goals):
  - Wiki-link rendering inside the static preview pane (see above).
  - Custom keybinding override UI — a different concern from scroll sync; explicitly not part of this change.
  - Sync scroll for the *inline* live-preview mode without the split panel open — this feature only applies when the split preview panel is open.
  - Custom/print stylesheet for the preview pane — it reuses the demo's existing theme CSS variables.
