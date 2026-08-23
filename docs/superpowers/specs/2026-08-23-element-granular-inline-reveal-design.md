# 元素级内联语法展开（Element-Granular Inline Reveal）

Date: 2026-08-23
Status: Approved for implementation
Change type: Bug fix restoring PRD-specified behavior (visible UX change; see causal analysis)

## Background

Current policy ("live preview") reveals raw Markdown syntax whenever any selection head is on the same **line** as an inline element:

- Wikilinks: `packages/core/src/wikilinks.ts:119-132, 160-166` via `selectionOnLine`
- Inline formats (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`): `packages/core/src/live-preview.ts:1228-1246` via `selectionOnSameLine`

Effect: clicking any character on a line flattens **all** wikilinks and inline formats on that line into raw syntax (`[[target|alias]]`, `**bold**`, …). This line-granular behavior is **not** an intentional UX design — it is the side effect of a bug fix (see the causal analysis below, which supersedes the earlier "explicit design decision" assessment).

Target behavior: **Obsidian-style element-granular reveal** — only the element containing the cursor reveals its raw syntax; clicking a space adjacent to a word, or any other position on the line, expands nothing. Other elements on the same line stay rendered.

Precedent in this codebase: images already use element-granular cursor awareness (cursor inside image range → source visible + preview; outside → widget only). See `packages/core/test/live-preview-regressions.test.ts` ("image widget-only when cursor outside; source + preview when inside").

## Why line-granularity is a bug, not a design (causal analysis)

**Claim:** the current "cursor anywhere on a line → all inline syntax on that line expands" behavior is a bug — specifically, an unnecessary behavior regression bundled into an unrelated bug fix, never specified by any product requirement, and justified by a false premise.

### Causal chain (with original sources)

**Step 1 — The product requirement is element-granular.** `prd.md:96` (§4.1 实时预览机制), verbatim:

> 当光标**不在**某个特定的 Markdown 结构（如 `**加粗**` 或 `![图片](url)`）**内部**时，将其折叠并替换为一个 Widget；当光标**移入**时，展开为源码供编辑。

("When the cursor is NOT inside a specific Markdown structure, collapse it; when the cursor moves INTO it, expand to source for editing.") — the specified granularity is the *structure* (element), not the line.

**Step 2 — The first implementation matched the PRD.** Git history (commit `9e2a5eb` message, verbatim) confirms the original code used element-granular detection:

> Root cause: hiding inline markers (**, *, ~~, \`) with Decoration.mark ({ color:transparent }) or font-size:0 created a mismatch between CM6's internal position coordinates and the actual DOM layout, causing click positions to drift after scrolling.

The diff shows the pre-fix predicate was per-element: `selectionIntersects(from, to, selection, inclusive)` in `live-preview-ranges.ts`.

**Step 3 — The defect was the hiding mechanism, not the granularity.** Per the same commit message, the click-desync root cause was `color:transparent` / `font-size:0` marks: invisible characters still occupied layout width, so CM6's document-offset ↔ DOM-coordinate mapping diverged from what the user sees. The granularity of the reveal predicate has no causal role in this defect.

**Step 4 — The fix bundled an unrelated behavior change.** Commit `9e2a5eb` (2026-04-17, "fix: switch to line-level edit/preview mode — fixes scroll click desync") changed two things at once, verbatim from the diff:

1. *Necessary:* transparent marks → `Decoration.replace({})` (zero-width) — the actual cure for the desync.
2. *Unnecessary:* per-element `selectionIntersects` → new `selectionOnSameLine`, with the diff comment:

   > Inline formatting: hide markers when cursor is on a DIFFERENT line. Line-level check prevents scroll/click desync caused by per-character range intersection with transparent marks or replace decorations.

   No requirement, issue, or design doc asks for line-level behavior; the diff itself attributes the desync to "transparent marks" — i.e., to change #1, not to per-element detection.

**Step 5 — The justification given is factually false.** The commit message claims:

> This matches Obsidian's approach: clicking anywhere on a line reveals all formatting markers on that line.

Obsidian's Live Preview reveals raw syntax only for the element containing the cursor; other elements on the same line stay rendered. The "Obsidian parity" rationale for line-granularity is wrong.

**Step 6 — The side effect was inherited as if it were policy.** `openspec/changes/add-wikilinks/proposal.md:11` ("`[[` / `]]` hidden when cursor is off the line, shown for editing when on the line") and `design.md:13` (Goals: "Cursor on the wikilink's line reveals `[[ ]]` brackets; cursor off hides them.") adopted line-granularity for wikilinks purely for consistency with the post-`9e2a5eb` inline formats — cementing the accidental behavior into a second feature. Neither change was ever archived into `openspec/specs/` (authoritative truth), which contains only plugin-* capabilities. `openspec/changes/add-missing-features/specs/live-preview/spec.md:12` ("markers `***` SHALL be hidden when cursor is outside") is ambiguous between element and line. `README.md:192` ("reveals raw syntax on cursor focus (Obsidian-style)") is likewise ambiguous.

### Conclusion

Every premise for line-granularity fails: the PRD specifies element-level (Step 1); the original defect was caused by the hiding mechanism, not granularity (Steps 2-3); the granularity change was an unrequested bundle in a bug fix (Step 4); its stated rationale is false (Step 5); and it never reached the authoritative spec layer (Step 6). The line-granular behavior is therefore a **long-lived bug** (behavior regression introduced by `9e2a5eb`, inherited by `c227bdc`), and this change restores the originally specified behavior.

**Constraint carried forward:** change #1 of `9e2a5eb` (zero-width `Decoration.replace` hiding) is the load-bearing fix and MUST be preserved untouched — this change replaces only the reveal predicate. The height-neutral invariant documented in `live-preview.ts:283-293` and CLAUDE.md-referenced commits (`3cf8c6b`, `5ec8daf`, `b73abef`) must not regress. Manual smoke: scroll + click accuracy around mixed rendered/raw lines.

## Requirements

1. **Element-granular reveal for all inline syntax** (wikilinks, strong, emphasis, delete, inlineCode, `[text](url)` links, autolinks): an element's raw markers are revealed only when a selection head is strictly inside the element's document span.
2. **Strict containment**: `from < head < to`. Caret at span boundaries or on an adjacent space MUST NOT expand the element.
   - **Exception (human-approved 2026-08-23)**: markdown links `[text](url)` and autolinks keep their pre-existing element-granular-with-inclusive-edges reveal (`selectionIntersects(..., true)`, live-preview.ts ~:1149-1174); strict containment applies to wikilinks and the generic inline formats (strong/emphasis/delete/inlineCode).
3. **Multi-cursor**: any `range.head` inside an element expands that element (each cursor is an independent reveal trigger, matching existing multi-cursor regression semantics).
4. **Nested formats**: ancestor chain auto-reveals (each ancestor node's span contains the head, so its markers show too). No extra logic needed; must be covered by tests.
5. **Click semantics unchanged**: plain mousedown on a rendered wikilink navigates (`onNavigate`). Editing a link stays keyboard-driven; arrowing into a link span reveals that link only.
6. **Out of scope (no changes)**: block-level behaviors (HTML-block raw-edit mode, image/heading/table/code-block widgets, footnotes), IME composition decoration mapping, table widget internals (`live-preview-table.ts` untouched), the wikilink autocomplete source, and click-to-navigate handler.
7. **Consistency between wikilinks and inline formats**: one shared predicate, single source of truth.

## Design

### Shared reveal predicate

Add to `packages/core/src/live-preview-ranges.ts` (home of the existing exported `selectionOnSameLine`):

```ts
/**
 * Element-granular reveal: true when ANY selection head lies strictly
 * inside the span (from, to). Replaces line-granular checks for inline
 * syntax so only the element containing the cursor reveals raw markers.
 * Heads are absolute document offsets (one per selection range).
 */
export function selectionInsideSpan(
  from: number,
  to: number,
  heads: readonly number[]
): boolean {
  return heads.some((head) => head > from && head < to);
}
```

`selectionOnSameLine` stays (still used by `live-preview.ts:448` for HTML-block composition handling).

### Call sites

1. **`packages/core/src/wikilinks.ts:160`** — replace `selectionOnLine(doc, m.from, m.to, selectionHeads)` with `selectionInsideSpan(m.from, m.to, selectionHeads)` (heads are already a `number[]` here, wikilinks.ts:266). Delete the local `selectionOnLine` helper. Update the header comment (wikilinks.ts:30-35) to describe the element-granular policy.
2. **`packages/core/src/live-preview.ts:1231`** — replace `selectionOnSameLine(range.from, range.to, doc, selection)` with `selectionInsideSpan(range.from, range.to, heads)` where `heads = selection.map((r) => r.head)` (computed once per `buildDecorations` call) in the inline-formatting branch. Update the comment block at live-preview.ts:1220-1227.

Note: `[text](url)` markdown links flow through the same branch (getInlineMarkerStyle "link" case), so they become element-granular automatically.

### Behavior matrix

| Scenario | Before | After |
|---|---|---|
| Caret moves into `[[a\|b]]` | whole line shows raw syntax | only `[[a\|b]]` shows raw syntax |
| Click a space adjacent to a link | whole line shows raw syntax | nothing expands |
| Other links/formats on same line | all flatten to raw | stay rendered |
| `**x *y* z**`, caret in `y` | whole line raw | `**` and `*` markers show (ancestor chain), content keeps styles |
| Multi-cursor in different elements | per-line per cursor | only elements containing a head expand |
| Arrow into rendered wikilink | impossible (click navigates; crossing lines flips) | link expands when head crosses into its span |
| Plain click on rendered wikilink | navigates | navigates (unchanged) |

### Known trade-off

Arrowing from outside into a rendered wikilink: the head traverses hidden `[[` positions; reveal triggers at the first interior position (`from + 1`). This matches Obsidian and is acceptable.

## Test Plan (TDD)

Rewrite assertions that encode line-granularity; add new coverage:

1. `packages/core/test/wikilinks.test.ts` ("wikilinks decorations (rendered output)", ~lines 58-151):
   - cursor inside link → raw shown for that link
   - cursor on same line but outside link → rendered (collapsed) — the key new assertion
   - two links on one line, cursor in first → only first raw
   - adjacent space click → no expansion
2. `packages/core/test/live-preview.test.ts`:
   - replace "restores raw markdown when cursor enters the same line" (~:86-100) with element-granular cases: caret inside `**bold**` shows `**`; caret elsewhere on the line keeps `**` hidden
3. `packages/core/test/live-preview-regressions.test.ts` (~:66-82 multi-cursor):
   - keep "every cursor is a reveal trigger" (still valid), adapt/add: two elements on the SAME line, cursor in one → only that one expands
4. New: nested ancestor-chain reveal (`**x *y* z**` caret in `y` → both marker sets visible)
5. New: `[text](url)` element-granular reveal
6. Existing non-inline suites (images, definitions, headings, tables) must pass unchanged.

## Documentation Updates

- `packages/core/src/wikilinks.ts:30-35` header comment — new policy wording
- `packages/core/src/live-preview.ts:1220-1227` comment — same
- No AGENTS.md rule changes (table widget rules unaffected; no change to `live-preview-table.ts`)

## Rollback

Revert the two call sites + predicate. No data/state migration needed.
