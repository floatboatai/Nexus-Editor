# Implementation Tasks

## 1. Fenced-callout body rendering pipeline

- [x] 1.1 Create `packages/core/src/mdast-to-html.ts`: `mdastToHtml(root)`
  serializes the adapter's node subset (paragraph, heading, blockquote,
  list/listItem incl. task checkboxes, code with `language-*` class,
  table with thead/tbody, thematicBreak, html passthrough; inline:
  text/strong/emphasis/delete/inlineCode/link/image/html/
  footnoteReference). Escape text and attribute values; URLs escape
  quotes as `%22`.
- [x] 1.2 In `lezer-mdast-adapter.ts`, change `buildCalloutHtml` to take
  a pre-rendered `bodyHtml` string; drop `white-space: pre-wrap` from
  the body container (bodies are now block HTML), add
  `font-size:0.95em;line-height:1.6;`.
- [x] 1.3 Add `renderCalloutBodyHtml(body)`: re-parse the body with
  `lezerStringToMdast` (same GFM + footnote config as the host doc),
  serialize via `mdastToHtml`, memoized by a single-slot cache keyed on
  the body source (keeps keystroke-time re-parses of unchanged bodies
  off the hot path).

## 2. Multi-paragraph fence re-assembly

- [x] 2.1 Add `CALLOUT_OPEN_RE` (opening fence line:
  `:::type [title]`) alongside the existing single-node
  `CALLOUT_FENCE_RE`.
- [x] 2.2 Implement `tryAdaptCalloutSpan(source, open)`: from an
  opening-fence Paragraph, scan sibling nodes line by line tracking
  nesting depth (`:::type` +1, bare `:::` −1); the depth-0 `:::` closes
  the span. Skip `FencedCode` / `CodeBlock` / `IndentedCode` /
  `HTMLBlock` / `CommentBlock` siblings wholesale so fenced code
  containing `:::` cannot close the callout. Extract the body between
  the opening fence line and the closing fence line, render via
  `renderCalloutBodyHtml`, and return the synthesized `html` node plus
  the closing sibling for iteration resumption.
- [x] 2.3 Rework `walkRoot` to iterate top-level nodes by sibling links
  (instead of a cursor) and consume merged callout spans in one step.
- [x] 2.4 Unclosed fence → `tryAdaptCalloutSpan` returns null →
  existing per-node handling renders the raw source (unchanged
  behaviour).
- [x] 2.5 Upgrade the single-node path in `adaptParagraph`
  (`CALLOUT_FENCE_RE`) to route its body through
  `renderCalloutBodyHtml` too — covers blank-line-free callouts nested
  inside blockquotes/lists where the sibling merge can't reach.

## 3. GFM Alert custom titles and fold markers

- [x] 3.1 Extend `ALERT_TAG_RE` to
  `/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([+-]?)(?:[ \t]+(.*?))?[ \t]*$/`;
  `detectAlert` returns `{ foldMarker, customTitle }` and extends
  `tagEndInLine` to end-of-line so the badge replaces the whole tag
  expression.
- [x] 3.2 `buildBlockquoteDecorations`: badge label = custom title
  (fallback: built-in type label); foldable alerts get a chevron span
  (`▸` collapsed / `▾` expanded) whose `mousedown` toggles fold state
  (`preventDefault` + `stopPropagation` so CM6 cursor placement doesn't
  race the toggle). Badge `eqKey` includes the folded state.
- [x] 3.3 Collapsed rendering: a block `Decoration.replace` widget
  (`⋯`, clickable to expand) covers `[head line end + 1, blockquote to]`;
  head line badge stays visible.
- [x] 3.4 Fold state plumbing in `livePreview()`: per-view
  `Map<offset, folded>` + `AlertFoldContext` passed into
  `buildDecorations`; `rebuildForAlertFold` StateEffect triggers a
  cache-reusing rebuild in the decoration field's `update`; `docChanged`
  clears the overrides; cursor inside the blockquote suspends folding
  (source stays editable).

## 4. Tests (`packages/core/test/live-preview.test.ts`)

- [x] 4.1 Fenced callouts:
  - multi-paragraph body → two `<p>` in `.nexus-callout-body`, no raw
    `:::` leaks;
  - inline markdown in body (`**bold**`, `` `code` ``, link) renders as
    real elements;
  - block markdown in body (list + fenced code with `language-js`
    class);
  - nested `:::warning` containing `:::info` renders both, inner inside
    outer;
  - `:::` inside a fenced code block does not close the outer callout;
  - unclosed fence falls back to plain paragraph text.
- [x] 4.2 GFM Alerts:
  - custom title (`> [!NOTE] Deploy checklist`) shows on the badge,
    raw tag not duplicated;
  - `-` marker collapses by default, chevron click expands;
  - `+` marker expands by default, chevron click collapses;
  - static alert has no chevron and never folds.

## 5. Verify

- [x] 5.1 `pnpm exec tsc --noEmit -p packages/core` clean.
- [x] 5.2 `vitest run packages/core` — 286/286 (17 files) including the
  11 new cases.
- [x] 5.3 `pnpm --filter @floatboat/nexus-core build` — ESM + dts emit
  cleanly.
- [ ] 5.4 Manual smoke in the electron demo — deferred (jsdom
  integration tests cover the same interaction paths).
