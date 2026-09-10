# Design: Callouts v2

## Context

The live-preview hot path is a synchronous Lezer-tree → mdast walk
(`lezer-mdast-adapter.ts`), consumed by `buildDecorations` in
`live-preview.ts`. `html` nodes render through the existing html-block
widget (innerHTML + sanitizer). Callout support today: fenced `:::type`
callouts match only inside a single Paragraph node, and GFM Alerts
recognize only the bare `[!TYPE]` tag.

## Goals / Non-Goals

- Goals: multi-paragraph fenced callouts; real markdown rendering inside
  bodies (inline + block + nested callouts); Obsidian custom titles and
  fold markers on GFM Alerts; no new dependencies; no public API
  changes; behaviour on malformed input unchanged (unclosed fences stay
  as plain text).
- Non-Goals: folding fenced callouts; configurable callout palettes;
  changing export/serialization paths (raw `:::` source round-trips).

## Decisions

### D1: Sibling re-assembly in `walkRoot` (not a Lezer extension)

A `@lezer/markdown` extension could teach the parser about `:::` fences
directly. We rejected it: the adapter is deliberately a thin, stateless
walk over the stock GFM + footnote configuration, and a custom block
parser would need to mirror CommonMark lazy-continuation rules to avoid
regressing everything that touches Paragraph nodes. Re-assembling the
sibling run *after* parsing is local, testable, and fails safe (miss →
plain paragraphs, exactly the old behaviour).

### D2: Depth-tracked line scan with block-sibling skips

`tryAdaptCalloutSpan` walks sibling node sources line by line:
`:::type` increments depth, a bare `:::` decrements it; depth 0 marks
the close. Siblings named `FencedCode` / `CodeBlock` / `IndentedCode` /
`HTMLBlock` / `CommentBlock` are skipped wholesale so their *content*
can't move the depth — a `:::` sample inside a code block is inert.
Nested callouts close on their own fence because the inner opening
fence raises depth before the inner close decrements it. The trade-off:
a `:::` line inside a *lazy paragraph* (not a code sibling) does affect
depth; that matches how Docusaurus treats unescaped fences and is
documented in the spec.

### D3: Body re-parse via `lezerStringToMdast` + `mdastToHtml`

Bodies are parsed with the same configured parser as the host document,
so dialect behaviour (GFM tables, task lists, footnotes) is identical at
top level and inside callouts. A new ~180-line serializer
(`mdast-to-html.ts`) covers the adapter's node subset; we don't add
`remark-rehype`/`rehype-stringify` to this path because the worker
round-trip is exactly what the adapter exists to avoid, and the subset
is small and fixed. Raw inline/block HTML inside bodies passes through
and is stripped by the html-block widget's existing sanitizer before it
reaches the DOM. A single-slot source-keyed cache absorbs repeated
re-renders of an unchanged body on selection-only updates; nested
bodies re-parse through the same cache (the outer write wins, which is
the hot case).

### D4: Alert fold state as per-view closure state + rebuild effect

Fold state doesn't need a StateField: it's view-local chrome, not
document state. A `Map<blockquoteFrom, folded>` inside the
`livePreview()` closure, toggled through an `AlertFoldContext` callback
that dispatches a `rebuildForAlertFold` StateEffect, is enough — the
decoration field's `update` reacts by rebuilding from the cached AST
(the document is unchanged, so no re-parse). Consequences we accept:
any edit clears the overrides (offsets are stale) and markers take over
again; two views on one document have independent fold state (same as
CM6 folding).

### D5: Collapsed body = block replace widget, not hidden lines

Hiding body lines with `display:none` breaks CM6's heightmap-to-DOM
invariant and shifts click resolution. The collapsed body is instead a
single block `Decoration.replace` widget (`⋯`, click to expand) covering
`[head line end + 1, blockquote end]`; the head line and its badge
remain real, decorated editor lines. Editing always wins: when the
cursor is inside the blockquote, folding is suspended entirely so the
full source stays visible and editable.

## Risks / Trade-offs

- **Per-keystroke cost in callout documents**: editing inside a callout
  body re-parses that body on every keystroke (the merged span's html
  node is rebuilt with the doc). Bounded by body size, same order as the
  Lezer incremental parse it rides on; the single-slot cache removes it
  for selection-only updates. Acceptable now, measurable via
  `NEXUS_PERF` logging later.
- **Unbalanced fences inside lazy paragraphs** can mis-scope a callout
  (D2 trade-off) — degrades to rendering more/less body, never to a
  crash or lost source.
- **Fold override keys are offsets**: cleared on any edit. A
  position-mapping approach would preserve folds across edits but adds
  mapping complexity for marginal benefit; revisit if users report it.
