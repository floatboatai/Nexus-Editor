# Change: Callouts v2 — full markdown bodies, nesting, and Obsidian-style foldable alerts

## Why

The editor currently understands two callout dialects, both with hard
limits that real notes hit immediately:

- **Fenced callouts** (`:::info Title` … `:::`, the Docusaurus/VitePress
  dialect) only render when the body is a *single blank-line-free
  paragraph*. The reason is structural: `@lezer/markdown` knows nothing
  about `:::` fences, so a body containing a blank line is split into
  sibling top-level nodes and the opening fence never reunites with its
  closing `:::`. The body is also emitted as **escaped plain text** —
  `**bold**`, lists, links, and code blocks inside a callout render as
  literal source. Multi-paragraph callouts — the most common shape in
  Docusaurus docs and Obsidian-flavored notes — simply don't render.
- **GFM Alerts** (`> [!NOTE]`) render nicely but only accept the bare
  `[!TYPE]` tag. Obsidian's extensions — a **custom title**
  (`> [!NOTE] Deploy checklist`) and **fold markers**
  (`> [!TIP]-` collapsed, `> [!TIP]+` expanded) — currently break alert
  detection entirely, degrading the blockquote to plain quoted text.

Callouts are a top-tier authoring feature (ROADMAP "Advanced Markdown"
theme). This change makes both dialects production-grade with no new
dependencies and no public API changes.

## What Changes

**Fenced callouts (`:::type`) — `packages/core/src/lezer-mdast-adapter.ts`**

- Multi-paragraph bodies: a new `tryAdaptCalloutSpan` pass in `walkRoot`
  re-assembles the sibling run from the opening-fence Paragraph through
  the matching closing fence into a single `html` node.
- Nesting: fence scanning tracks depth (`:::type` opens, bare `:::`
  closes), so a callout containing another callout closes on *its own*
  fence, not the inner one.
- Body rendering: the body source is re-parsed with the same
  GFM + footnote Lezer configuration as the host document
  (`lezerStringToMdast`) and serialized via a new minimal
  `mdastToHtml` walker (`packages/core/src/mdast-to-html.ts`) — inline
  marks, lists, tables, code blocks, and nested callouts all render.
- `:::` lines inside fenced code / indented code / raw HTML sibling
  blocks are skipped by the depth scanner, so a code sample containing
  `:::` cannot prematurely close the callout.
- Unclosed fences keep the historical behaviour: fall through to plain
  paragraphs (raw source stays visible while typing the fence).

**GFM Alerts — `packages/core/src/live-preview.ts`**

- `ALERT_TAG_RE` now accepts `[!TYPE]` followed by an optional fold
  marker (`-`/`+`) and an optional custom title; the badge replaces the
  whole expression (tag + marker + title) so no raw source leaks.
- Foldable alerts render a chevron (`▸`/`▾`) on the badge. Clicking it
  toggles the body; when collapsed, every body line is replaced by one
  clickable `⋯` block placeholder (the head line with the badge stays
  visible).
- Fold state lives in a per-view `Map` keyed by blockquote offset,
  toggled via a `StateEffect` that rebuilds decorations from the cached
  AST (no re-parse). Any document edit clears the overrides — offsets
  are invalidated, and mid-edit the author sees raw source anyway.
  Editing always wins: with the cursor inside the blockquote, folding
  is suspended and the full source is visible.
- Static alerts (no marker) are unchanged: icon + built-in label, no
  chevron, never fold.

**New module**

- `packages/core/src/mdast-to-html.ts` — a ~180-line serializer for the
  node subset the adapter emits (paragraph, heading, list, code, table,
  blockquote, thematicBreak, html, and the inline set). Output mirrors
  remark-html's shape for that subset. Consumed only by callout body
  rendering; raw HTML inside bodies passes through the existing
  html-block sanitizer before reaching the DOM.

No breaking changes, no new dependencies, no public API changes.

## Impact

- Affected specs:
  - `live-preview` — fenced callouts with multi-paragraph/nested bodies;
    alert custom titles; alert fold markers and toggle behaviour.
- Affected code:
  - `packages/core/src/lezer-mdast-adapter.ts` — fence re-assembly
    (`tryAdaptCalloutSpan`), body re-parse (`renderCalloutBodyHtml`,
    single-slot cache), `buildCalloutHtml` emits rendered HTML.
  - `packages/core/src/mdast-to-html.ts` (NEW).
  - `packages/core/src/live-preview.ts` — `ALERT_TAG_RE`,
    `detectAlert`, `buildBlockquoteDecorations` (chevron, fold
    placeholder), fold-state plumbing (`AlertFoldContext`,
    `rebuildForAlertFold`).
  - `packages/core/test/live-preview.test.ts` — 11 new cases.
- Out of scope (explicit non-goals):
  - Folding fenced (`:::`) callouts — the Obsidian dialect for that is
    the blockquote form; adding fold state to the html-block widget
    would need widget-internal state and can layer on later.
  - Custom callout types/palette via config — the palette is
    code-defined today; a `LivePreviewConfig` extension is a separate
    proposal.
  - Serializing callouts back through `remark` export paths — export
    keeps the raw `:::` source, which round-trips losslessly.
