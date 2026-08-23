# 元素级内联语法展开（Element-Granular Inline Reveal）

Date: 2026-08-23
Status: Approved for implementation
Change type: Intentional behavior change (UX breaking)

## Background

Current policy ("live preview") reveals raw Markdown syntax whenever any selection head is on the same **line** as an inline element:

- Wikilinks: `packages/core/src/wikilinks.ts:119-132, 160-166` via `selectionOnLine`
- Inline formats (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`): `packages/core/src/live-preview.ts:1228-1246` via `selectionOnSameLine`

Effect: clicking any character on a line flattens **all** wikilinks and inline formats on that line into raw syntax (`[[target|alias]]`, `**bold**`, …). This was an explicit design decision (wikilinks.ts:30-35: "Markers are hidden only when the cursor is off the same line — same policy as inline strong/emphasis/link", introduced in commit `c227bdc`), but the UX is now judged poor.

Target behavior: **Obsidian-style element-granular reveal** — only the element containing the cursor reveals its raw syntax; clicking a space adjacent to a word, or any other position on the line, expands nothing. Other elements on the same line stay rendered.

Precedent in this codebase: images already use element-granular cursor awareness (cursor inside image range → source visible + preview; outside → widget only). See `packages/core/test/live-preview-regressions.test.ts` ("image widget-only when cursor outside; source + preview when inside").

## Requirements

1. **Element-granular reveal for all inline syntax** (wikilinks, strong, emphasis, delete, inlineCode, `[text](url)` links, autolinks): an element's raw markers are revealed only when a selection head is strictly inside the element's document span.
2. **Strict containment**: `from < head < to`. Caret at span boundaries or on an adjacent space MUST NOT expand the element.
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
