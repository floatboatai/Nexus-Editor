## Context

Nexus is AST-driven (`mdast`) with CodeMirror 6 as the editing surface and an inline, Obsidian-style live preview — there is no rendered HTML preview surface anywhere in the codebase today. This design's bar: precise scroll alignment (not approximate), zero new dependencies, and a change scoped to exactly one concern (see `proposal.md` § Why).

## Goals / Non-Goals

- Goals: precise (offset-based) two-way scroll sync between the editor and a new read-only rendered preview pane; zero new runtime dependencies; opt-in, no default UX change; single concern (no bundled unrelated feature).
- Non-Goals: wiki-link rendering in the static preview; a keybinding customization UI; multi-pane layouts beyond one editor + one preview.

## Decisions

### Decision: sync anchor is a character offset, not a line number

`lezer-mdast-adapter.ts`'s `position()` helper (`packages/core/src/lezer-mdast-adapter.ts:48-57`) hardcodes `line: 0, column: 0` on every node — only `.offset` is ever populated:

```ts
function position(from: number, to: number): PositionedNode["position"] {
  return {
    start: { line: 0, column: 0, offset: from },
    end: { line: 0, column: 0, offset: to },
  };
}
```

The file's own comment (line 53) states live-preview only ever reads offsets. Line-based anchoring is therefore unavailable without changing a heavily-depended-on adapter that every other live-preview subsystem trusts, and doing so is out of scope for this change. Offset-based anchoring needs no such change and is naturally exact, since CM6's own coordinate system is already character offsets — no conversion layer needed.

- **Alternative considered**: percentage scroll (`scrollTop / scrollHeight`) — rejected. Block heights vary too much (a fenced code block vs. a heading vs. a table) for percentage math to keep the two panes visually aligned.

### Decision: `scroll` is a pushed event on `EditorEventMap`, not a pulled `getViewportOffset()` method

Matches the existing `change` / `selectionChange` convention — hosts already know how to subscribe to continuous editor state via `editor.on(...)`. A new pull-style method would be a second, inconsistent way to observe editor state, and would push the rAF-throttling responsibility onto every host instead of centralizing it once in core.

### Decision: read side is a `scroll` event, write side is `scrollToOffset(offset, ratio?)` — both stay in content-space, never screen-space

The natural-looking write-side implementation would reuse `getCoordsAtPos()` (offset → screen rect) and translate that into a `scrollTop` delta on the host side. That leaks CM6 scroll-container geometry into `apps/electron-demo` and requires the host to reason about viewport rects it has no other reason to touch. Instead, both directions stay inside `core` and operate purely in CM6's content-space height coordinates: the read side uses `view.lineBlockAtHeight(view.scrollDOM.scrollTop)` (scroll offset → block), the write side uses `view.lineBlockAt(offset)` + directly setting `view.scrollDOM.scrollTop` (block → scroll offset). Symmetric, and the CM6 `EditorView` itself still never leaks past `core`.

### Decision: preview HTML is generated from the already-computed `editor.getAst()` tree, not by re-parsing markdown text

`editor.ts`'s `createTransformProcessor` (`editor.ts:217-229`) already demonstrates running a unified processor's transformers against an existing tree via `processor.runSync(tree)` instead of `processor.parse(text)`. `renderPreviewHtml` reuses this pattern: `unified().use(remarkRehype).use(rehypeStringify)`, then `processor.runSync(ast)` to get the hast tree, inject `data-offset` attributes, then `processor.stringify(hast)`. This avoids a second parse pass and keeps the preview byte-for-byte consistent with `getAst()` / the `change` event's AST — no drift between what `getAst()` reports and what the preview shows.

- **Alternative considered**: reusing `live-preview-renderers.ts`'s `renderLivePreviewNode` — rejected because it's built to render one node as a self-contained CM6 widget and flattens child content to plain text via `getText()`. Reusing it for a full recursive preview would silently drop inline formatting (bold/italic/links inside a heading, for example).

### Decision: feedback-loop prevention via a single `isSyncingScroll` boolean flag

Set immediately before a programmatic scroll is applied, cleared on the next `requestAnimationFrame`. Two-way scroll bindings are a known source of infinite scroll ping-pong; this is the standard mitigation and keeps the demo-side code a plain flag instead of a state machine.

### Decision: split preview defaults off

Matches the existing pattern for opt-in visual changes in this codebase — `multiCursor` defaults off for the same reason (see `add-core-multi-cursor/design.md` Decision 1). Avoids changing the demo's default layout/screenshots and keeps this change purely additive.

## Discovered during implementation: pre-existing unresolved-shortcut-link bug

Writing the `renderPreviewHtml` tests against real `[[Wiki Link]]` fixtures (not hand-built ASTs) surfaced that `[[Some Note]]` does not render as literal text the way the original proposal assumed. What actually happens, traced to `lezer-mdast-adapter.ts:310-360` (the `Link`/`Autolink`/`URL` case):

1. The outer `[` / `]` pair does not form a valid nested link (CommonMark disallows an unescaped `[` inside a link label), so those two characters stay literal text — this part matches the original assumption.
2. The inner `[Some Note]` is itself a syntactically valid CommonMark **shortcut reference link** with no matching definition. `@lezer/markdown` still tags it as a `Link` syntax node (parsing is definition-agnostic). The adapter's fallback — `readSlice(node.from, node.to)` when no `URL` child exists — is written for bare autolinks (`<https://x>`, `https://x` with no `[]`), but the same code path also catches this bracket-only, no-destination case, producing `href="[Some Note]"` (URL-encoded on output): a link element with a nonsensical, self-referential destination instead of degrading to plain text.

This is a **pre-existing bug in a shared, heavily-depended-on adapter**, unrelated to sync-scroll-preview, and out of scope here: this change stays to one concern and doesn't bundle unrelated fixes into a feature PR. The spec for this change (`specs/sync-scroll-preview/spec.md`) describes the verified actual behavior rather than the originally-assumed "renders as plain text." A correct fix (skip the link entirely — or treat it as a bracketed-text fallback — when a `Link` node has no `URL` child *and* no matching `Definition`) belongs in its own standalone bug-fix PR against `lezer-mdast-adapter.ts`, with its own regression test, since any change to that file affects every consumer of `editor.getAst()`, not just this preview pane.

## Discovered during self-review: ratio computed in two incompatible units

A structured review of the implementation (8 independent finder passes, correctness + cleanup) surfaced that the `scroll` event's `ratio` and `scrollToOffset`'s `ratio` parameter were being used to mean two different things across the core/demo boundary:

- `editor.ts`'s `createScrollTracker` computes `ratio` as the fractional position within a single CM6 **source line** (`view.lineBlockAtHeight` returns one line's `BlockInfo`).
- `preview-panel.ts`'s `findTopmostVisible` (now `findLastAtOrBefore`) computed `ratio` as the fractional position within a rendered top-level **AST block** (a `<p>`, `<li>`, etc.), which can span many source lines — a multi-line paragraph or a whole fenced code block.

Applying one side's ratio against the other side's (differently-sized) block produces a real misalignment for any multi-line block: e.g. scrolling to 60% through a 3-line paragraph in the preview would translate to `scrollToOffset(offset, 0.6)` in the editor, but `0.6` there means "60% through one line," not "60% through the paragraph" — the editor lands near the top of the paragraph regardless of how far down the user actually was.

**Fix**: dropped ratio-based sub-block interpolation from both directions of the sync — `onEditorScroll` aligns `target.el.offsetTop` directly (no `+ ratio * height` term), and `onPanelScroll` calls `editor.scrollToOffset(target.offset)` with no ratio argument (defaults to the block's exact top). This is a narrower guarantee than originally designed — block-top alignment only, not smooth sub-block interpolation — but it's *correct*, whereas the two-unit ratio mixing was silently wrong. The `scroll` event still emits `ratio` (now exported as `ScrollPayload`, `packages/core/src/types.ts`) since it's still a well-defined, locally-meaningful value on the editor side alone; the bug was specifically in reusing it across the core/demo, CM6-line/DOM-block boundary, not in computing it.

A correct sub-block fix would require plumbing mdast block-range boundaries into the core scroll tracker (which currently only knows about CM6 lines, not AST blocks) — a bigger, more invasive change than this refinement is worth; block-level alignment is already far more precise than the percentage-based approach this feature exists to replace.

## Discovered during self-review: shared `togglePanel()` bug fixed at the source, not worked around

The offsetParent/`display:flex`-restore fix documented above (`## Discovered during implementation`) was initially applied only to `preview-panel.ts`'s own `setPreviewVisible`, leaving `apps/electron-demo/src/renderer/app.ts`'s shared `togglePanel()` helper — used by the pre-existing outline/vault/backlinks panels, all of which are also `display: flex` internally — with the same latent bug (`panel.style.display = ""` on show, instead of restoring an explicit value). Self-review flagged this from two independent angles: a reuse angle (the new panel duplicates `togglePanel`'s job instead of extending it) and an altitude angle (the fix belongs in the shared mechanism, not bolted onto one caller).

**Fix**: `togglePanel(panel, showDisplay, onShow?)` now takes the show-state display value as an explicit parameter instead of clearing to `""`; all four call sites (`toggleOutline`, `toggleVault`, `toggleBacklinks`, and the preview panel's own toggle path) pass `"flex"`. This is judged in-scope rather than a bundled unrelated fix (the discipline this proposal otherwise holds to — see the wiki-link bug above, deliberately deferred): unlike that adapter bug, this fix is exercising the exact mechanism the new preview panel itself depends on to show/hide correctly, at the shared call site that mechanism already lives at, with a net reduction in new code (removes the need for a bespoke workaround).

## Discovered during self-review: minor hardening and cleanup

- `preview-panel.ts`'s `isSyncingScroll` guard now clears two animation frames after a programmatic scroll, not one. CM6's own scroll tracker (`editor.ts`) is itself rAF-throttled, so a programmatic `scrollDOM.scrollTop` write echoes back through its native `scroll` event, into that internal throttle, and out through the `scroll` event listener one frame later than the write itself; a single-frame guard could clear before that echo arrives, letting it trigger a redundant re-sync.
- `findNearestByOffset` and `findTopmostVisible` were two copies of the same "last entry at-or-before a threshold" forward scan, differing only in which field was compared. Collapsed into one `findLastAtOrBefore(entries, threshold, keyOf)`.
- `apps/electron-demo/src/renderer/app.ts`'s settings-panel `onChange` fires on every field mutation (e.g. each `input` event while dragging the font-size slider), and was unconditionally calling `setPreviewVisible(settings.splitPreview)` — a full preview re-render when visible — even when `splitPreview` hadn't changed. Now tracks the last-applied value and only re-applies on an actual change.
- Exported `ScrollPayload` (the `scroll` event's `{ offset, ratio }` shape) from `packages/core/src/types.ts` / `index.ts`, matching the precedent set by `SelectionState` for `selectionChange` — hosts (and this change's own `preview-panel.ts`) no longer need to hand-redeclare the inline shape.

Considered and deliberately not changed: centralizing the rAF-throttle-a-scroll-handler boilerplate shared between `editor.ts` and `preview-panel.ts` (would require new cross-package public API surface to save ~5 lines — not worth it); the per-frame `querySelectorAll("[data-offset]")` cost in the scroll-sync path (already an accepted trade-off — see Risks / Trade-offs below); a main-process `will-navigate` / `setWindowOpenHandler` guard in `electron/main.ts` as a defense-in-depth alternative to `preview-panel.ts`'s own click interception (a strictly more robust fix protecting every current and future renderer surface, but a separate, standalone hardening effort — this change's own preview pane is already safe without it).

## Discovered during manual verification: the adapter emits non-spec mdast shapes — GFM tables and task lists rendered empty

Manual testing surfaced that tables rendered as empty `<tr></tr>` shells and task-list items (`- [ ] …`) rendered as a bare checkbox with no text. Probed (not assumed) by dumping the actual mdast from `lezerStringToMdast` and the raw Lezer syntax tree; two distinct causes in `lezer-mdast-adapter.ts`, both of the same class — **the adapter emitted structurally-plausible but non-spec mdast that its original consumer never noticed**, because the live-preview decoration pipeline only reads node offsets (the adapter's own line-53 comment says exactly this) and the editor's table/checkbox widgets re-derive everything from source text:

1. **`adaptTable` hardcoded `align: []`.** The mdast the adapter produced actually had complete rows/cells/text — but `mdast-util-to-hast`'s tableRow handler emits exactly `align.length` cells per row (the align array's length doubles as the column count in real remark output, where it's always populated from the delimiter row). An empty array = zero columns = every row rendered cell-less. Verified by taking the identical tree, setting `align = [null, null]`, and watching the same renderer produce a perfect table. **Fix**: parse the delimiter row (`| :-- | :-: | --: |` → left/center/right/null per column) via the existing `tableCellContentRanges` helper; fall back to `rows[0].children.map(() => null)` if no delimiter row is found, so `align.length` always matches the real column count.
2. **`adaptListItem`'s Task branch walked child nodes that don't exist.** In Lezer trees, plain text is implicit — it lives in the *gaps* between nodes, not in nodes. A `Task` node's only structural child is its `TaskMarker` (`[ ]`/`[x]`); the item's text after it is a gap. The old code looped over Task's child nodes looking for block content, found only the (skipped) marker, and produced `children: []`. **Fix**: walk Task as *inline* content via the adapter's existing `emitInline` (which emits gap text as Text nodes and already skips `TaskMarker` via `MARKER_NODE_NAMES`), trim the marker-separating whitespace off the first text node, and wrap the result in the `paragraph` node mdast consumers expect. Nested blocks under a task item (child bullets etc.) were already handled by the outer loop and are unaffected.

**Scope judgment — why these two adapter fixes are in this change while the wiki-link adapter bug stays deferred:** the task-item text simply is not present in the tree — no downstream layer can recover it, so there is no "work around it locally" option at all; and while the `align` symptom *could* have been papered over in `live-preview-to-html.ts`, both defects share one root cause (non-spec adapter output) and papering over one of them locally would leave `getAst()` still broken for every other consumer (the wordcount plugin, for instance, was silently not counting task-list item text). The wiki-link case is the opposite on every axis: non-standard syntax, cosmetic wrong-`href` output, a live workaround already in place (the preview's absolute-URL click guard), and a riskier fix (changing `Link` fallback semantics). Both fixes here are narrow, covered by new regression tests through the preview path, and the full suite (including live-preview's 100+ tests and wordcount's) passes unchanged.

## Discovered during manual verification: window.open on a non-absolute href reopens the app

Manual testing of the link-click-safety fix (Ctrl-clicking a rendered link) surfaced that Ctrl-clicking a wiki-link-produced garbage link (`href="[Some Note]"`, see the unresolved-shortcut-link bug above) opened a **new window showing the editor app itself**, not an external site. Cause: `window.open(href, ...)` was called with whatever string was in the `href` attribute, unvalidated. `"[Some Note]"` is not an absolute URL, so the browser resolves it as a path *relative to the current page* — in dev, the Vite dev server's own origin — and Vite's dev server serves `index.html` for unmatched paths (standard SPA fallback), so the "external" open silently reopened a whole extra copy of the app instead of failing visibly or doing nothing.

**Fix**: `onContentClick` now only calls `window.open` when the href parses as an absolute `http:`/`https:` URL (`new URL(href)` with no base argument throws for anything that isn't already absolute — this is the check, not a regex). Anything else — including this specific wiki-link artifact, but also any other malformed or accidentally-relative href in arbitrary markdown content — is now a no-op on Ctrl/Cmd-click too (the plain-click `preventDefault()` already made it a no-op for a plain click). This strengthens, rather than expands, the existing wiki-link "known limitation": Ctrl-clicking a broken wiki-link-produced anchor now safely does nothing instead of confusingly opening a new app window.

## Risks / Trade-offs

- rAF-throttled scroll listeners run on every animation frame while actively scrolling; mitigated by doing only a cheap `lineBlockAtHeight` lookup per frame. The tracker is installed for every editor instance, so hosts that never subscribe still pay that (small) per-scroll-frame lookup — accepted for v1 rather than adding listener-count plumbing to the event emitter.
- The preview pane's `data-offset` nearest-neighbor lookup is a linear scan over top-level rendered blocks. Acceptable for typical documents (tens to low hundreds of blocks); not optimized for pathological documents with thousands of blocks. Flagged as a follow-up if it surfaces in practice — not blocking for this change.

## Migration Plan

Purely additive. No existing behavior changes when `splitPreview` / the panel toggle is left at its default (off). No data migration.

## Open Questions

None blocking. Wiki-link rendering inside the static preview pane is deferred to a follow-up change once this lands (see `proposal.md` § Out of scope).
