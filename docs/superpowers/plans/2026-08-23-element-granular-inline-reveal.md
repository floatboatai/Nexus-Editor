# Element-Granular Inline Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace line-granular inline-syntax reveal with element-granular reveal, restoring the PRD-specified behavior (cursor inside element → only that element shows raw syntax).

**Architecture:** Add one shared predicate `selectionInsideSpan(from, to, heads)` in `packages/core/src/live-preview-ranges.ts` and swap it in at the two reveal call sites (`wikilinks.ts` decorations builder, `live-preview.ts` inline-formatting branch). Hiding mechanism (zero-width `Decoration.replace` + `Decoration.mark`) is untouched. TDD throughout: new failing tests first, then implementation.

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Vitest (jsdom), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-element-granular-inline-reveal-design.md` (contains the causal analysis proving line-granularity is a bug, not a design).

## Global Constraints

- Reveal predicate semantics: strict containment — `from < head < to` per selection head; ANY head inside → reveal (multi-cursor).
- Hiding mechanism MUST stay `Decoration.replace({})` zero-width + `Decoration.mark` — the height-neutral / click-drift invariant (`9e2a5eb`, `live-preview.ts:283-293`, CLAUDE.md) must not regress.
- Do NOT modify: `packages/core/src/live-preview-table.ts` (AGENTS.md table rules), block-level widgets (heading/HTML/image/table/code/footnote), `selectionOnSameLine` (still used at `live-preview.ts:448` heading-composition guard), wikilink click-to-navigate handler, wikilink autocomplete.
- Click semantics: plain mousedown on a rendered wikilink navigates; editing links stays keyboard-driven.
- Run tests with `pnpm vitest run <file>` from repo root.
- Commit style: `feat(core):` / `test(core):` / `docs(core):` per repo history.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/live-preview-ranges.ts` | range collection + selection predicates | ADD exported `selectionInsideSpan` |
| `packages/core/src/wikilinks.ts` | wikilink decorations + click + autocomplete | REPLACE `selectionOnLine` call; DELETE local helper; UPDATE header comment |
| `packages/core/src/live-preview.ts` | live-preview decoration builder | REPLACE `selectionOnSameLine` at inline branch (~:1231); UPDATE comment block ~:1220-1227 |
| `packages/core/test/live-preview-ranges.test.ts` | predicate unit tests | ADD describe block |
| `packages/core/test/wikilinks.test.ts` | wikilink decoration behavior | REWRITE "wikilinks decorations" cases for element granularity + ADD new cases |
| `packages/core/test/live-preview.test.ts` | inline formatting behavior | UPDATE :61-62 comment + "restores raw markdown" test; ADD element-granular + `[text](url)` cases |
| `packages/core/test/live-preview-regressions.test.ts` | regression guards | UPDATE multi-cursor test; ADD same-line multi-element + nested-chain cases |

---

### Task 1: `selectionInsideSpan` predicate (TDD)

**Files:**
- Modify: `packages/core/src/live-preview-ranges.ts` (after `selectionOnSameLine`, ~line 70)
- Test: `packages/core/test/live-preview-ranges.test.ts`

**Interfaces:**
- Produces: `export function selectionInsideSpan(from: number, to: number, heads: readonly number[]): boolean` — consumed by `wikilinks.ts` (Task 3) and `live-preview.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/live-preview-ranges.test.ts` (add `selectionInsideSpan` to the existing import from `../src/live-preview-ranges`):

```ts
describe("selectionInsideSpan", () => {
  it("returns true when a head is strictly inside the span", () => {
    expect(selectionInsideSpan(10, 20, [15])).toBe(true);
  });

  it("returns false at span boundaries (strict containment)", () => {
    expect(selectionInsideSpan(10, 20, [10])).toBe(false);
    expect(selectionInsideSpan(10, 20, [20])).toBe(false);
  });

  it("returns false for a head on the same line but outside the span", () => {
    // one character before the span (e.g. a space adjacent to a word)
    expect(selectionInsideSpan(10, 20, [9])).toBe(false);
  });

  it("returns true when ANY of multiple heads is inside", () => {
    expect(selectionInsideSpan(10, 20, [0, 15, 99])).toBe(true);
  });

  it("returns false for an empty heads list", () => {
    expect(selectionInsideSpan(10, 20, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/live-preview-ranges.test.ts`
Expected: FAIL — `selectionInsideSpan is not a function` (import error).

- [ ] **Step 3: Implement the predicate**

In `packages/core/src/live-preview-ranges.ts`, after `selectionOnSameLine` (~line 70):

```ts
/**
 * Element-granular reveal: true when ANY selection head lies strictly
 * inside the span (from, to). Inline syntax (wikilinks, bold, italic, ...)
 * reveals raw markers only for the element containing the cursor —
 * adjacent spaces and other elements on the same line stay rendered.
 * Heads are absolute document offsets, one per selection range.
 */
export function selectionInsideSpan(
  from: number,
  to: number,
  heads: readonly number[]
): boolean {
  return heads.some((head) => head > from && head < to);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/live-preview-ranges.test.ts`
Expected: PASS (all 5 new cases + existing suite).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/live-preview-ranges.ts packages/core/test/live-preview-ranges.test.ts
git commit -m "feat(core): add selectionInsideSpan element-granular reveal predicate"
```

---

### Task 2: Element-granular wikilink tests (failing first)

**Files:**
- Test: `packages/core/test/wikilinks.test.ts` (describe "wikilinks decorations (rendered output)", lines 58-151)

**Interfaces:**
- Consumes: existing `createWikilinksPlugin` mount helper (lines 59-68) — unchanged.
- Behavior contract (drives Task 3): reveal iff any head strictly inside `[m.from, m.to]`.

- [ ] **Step 1: Rewrite/extend decoration tests to element-granular expectations**

In `packages/core/test/wikilinks.test.ts`, replace the test `"shows raw [[ ]] when cursor is on the same line"` (lines 86-92) with these three tests (keep the other tests in the describe block unchanged):

```ts
  it("shows raw [[ ]] only when the cursor is inside the link span", () => {
    const { container, editor } = mount("Look at [[MyNote]] now\n\nend");
    // inside the link: offset of "MyNote"
    const inside = ("Look at [[MyNote]] now").indexOf("MyNote");
    editor.setSelection(inside);
    expect(container.textContent).toContain("[[MyNote]]");

    // same line, before the link → stays rendered
    editor.setSelection(1);
    expect(container.textContent).not.toContain("[[");
    expect(container.textContent).toContain("MyNote");

    // same line, after the link → stays rendered
    editor.setSelection(("Look at [[MyNote]] now").length - 1);
    expect(container.textContent).not.toContain("[[");
    editor.destroy();
  });

  it("expands only the link containing the cursor when several share a line", () => {
    const { container, editor } = mount("a [[A]] b [[B]] c\n\nend");
    // cursor inside [[A]]: "a [[A]]" → index of "A" is 5
    editor.setSelection(5);
    const text = container.textContent ?? "";
    expect(text).toContain("[[A]]");
    expect(text).not.toContain("[[B]]");
    expect(text).toContain("B");
    editor.destroy();
  });

  it("does not expand the link when the cursor is on an adjacent space", () => {
    const { container, editor } = mount("x [[A]] y\n\nend");
    // "x [[A]] y": space before the link is at offset 1, "x" is 0, "[[" starts at 2.
    // head=2 is the span boundary (from) — strict containment keeps it collapsed.
    editor.setSelection(2);
    const text = container.textContent ?? "";
    expect(text).not.toContain("[[");
    expect(text).toContain("A");
    editor.destroy();
  });
```

- [ ] **Step 2: Run tests to verify the new expectations fail**

Run: `pnpm vitest run packages/core/test/wikilinks.test.ts`
Expected: FAIL — `"shows raw [[ ]] only when the cursor is inside the link span"` and `"expands only the link containing the cursor..."` fail because current code reveals on-line.

- [ ] **Step 3: Commit failing tests (documents the contract)**

```bash
git add packages/core/test/wikilinks.test.ts
git commit -m "test(core): wikilink reveal contract is element-granular (failing)"
```

---

### Task 3: Wikilinks implementation

**Files:**
- Modify: `packages/core/src/wikilinks.ts` (header comment lines 30-35; helper lines 119-132; call site line 160)
- Test: `packages/core/test/wikilinks.test.ts`

**Interfaces:**
- Consumes: `selectionInsideSpan(from, to, heads)` from `./live-preview-ranges` (Task 1).
- Note: `wikilinks.ts` has NO existing import from `live-preview-ranges`; add one.

- [ ] **Step 1: Swap the reveal predicate**

In `packages/core/src/wikilinks.ts`:

1. Add import at the top (after the `./types` import, line 10):

```ts
import { selectionInsideSpan } from "./live-preview-ranges";
```

2. Delete the local `selectionOnLine` function (lines 119-132) entirely.

3. At line 160, replace:

```ts
    const onLine = selectionOnLine(doc, m.from, m.to, selectionHeads);

    if (onLine) {
```

with:

```ts
    const active = selectionInsideSpan(m.from, m.to, selectionHeads);

    if (active) {
```

4. Update the header comment (lines 34-35) — replace:

```
 *   - Markers are hidden only when the cursor is off the same line as the
 *     wikilink — same policy as inline strong/emphasis/link.
```

with:

```
 *   - Markers are revealed only while a selection head is strictly inside
 *     the wikilink span (element-granular, PRD §4.1) — same policy as
 *     inline strong/emphasis/link via selectionInsideSpan.
```

- [ ] **Step 2: Run wikilink tests to verify they pass**

Run: `pnpm vitest run packages/core/test/wikilinks.test.ts`
Expected: PASS (all cases, including the three element-granular ones from Task 2).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/wikilinks.ts
git commit -m "fix(core): wikilinks reveal raw syntax only for the element under the cursor"
```

---

### Task 4: Element-granular inline-format tests (failing first)

**Files:**
- Test: `packages/core/test/live-preview.test.ts` (lines 61-62 comment, test at 86-102) and `packages/core/test/live-preview-regressions.test.ts` (test at 66-88)

**Interfaces:**
- Behavior contract (drives Task 5): inline marker replace-decorations emitted iff NO head strictly inside the node span; inner style mark always applied.

- [ ] **Step 1: Rewrite line-granular assertions**

In `packages/core/test/live-preview.test.ts`:

a) Replace the comment at lines 61-62:

```ts
  // Note: inline markers are hidden when cursor is on a DIFFERENT line (line-level detection).
  // Tests use multi-line content with cursor moved to a separate line.
```

with:

```ts
  // Inline markers are hidden unless a selection head is strictly inside the
  // element's span (element-granular reveal). Caret elsewhere on the same
  // line, or on an adjacent space, keeps the element rendered.
```

b) Replace the test `"restores raw markdown when cursor enters the same line"` (lines 86-102) with:

```ts
  it("reveals raw markdown only when the cursor enters the element span", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** end\n\nother",
      livePreview: true
    });

    // Cursor on a different line → markers hidden
    editor.setSelection(editor.getDocument().length);
    expect(container.textContent).not.toContain("**");

    // Cursor on the same line but OUTSIDE the element → still rendered
    editor.setSelection(1);
    expect(container.textContent).not.toContain("**");
    editor.setSelection(("Text **bold** end").length - 1);
    expect(container.textContent).not.toContain("**");

    // Cursor inside the element → markers visible
    editor.setSelection(8);
    expect(container.textContent).toContain("**bold**");
    editor.destroy();
  });

  it("expands only the touched element when several share a line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a **one** b **two** c\n\nend",
      livePreview: true
    });

    // inside **one**: "a **one**" → offset of "one" is 5
    editor.setSelection(5);
    let text = container.textContent ?? "";
    expect(text).toContain("**one**");
    expect(text).not.toContain("**two**");
    expect(text).toContain("two");

    // move into **two** → first re-collapses, second expands
    editor.setSelection(("a **one** b **two** c").indexOf("two"));
    text = container.textContent ?? "";
    expect(text).not.toContain("**one**");
    expect(text).toContain("one");
    expect(text).toContain("**two**");
    editor.destroy();
  });

  it("reveals markdown [text](url) link markers only inside the link span", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "x [link](https://example.com) y\n\nend",
      livePreview: true
    });

    editor.setSelection(editor.getDocument().length);
    expect(container.textContent).not.toContain("](");

    // same line, outside → stays collapsed
    editor.setSelection(0);
    expect(container.textContent).not.toContain("](");

    // inside the link text
    editor.setSelection(("x [link](https://example.com) y").indexOf("link"));
    expect(container.textContent).toContain("[link](https://example.com)");
    editor.destroy();
  });
```

In `packages/core/test/live-preview-regressions.test.ts`:

c) Update the multi-cursor test (lines 66-88): keep the cross-line assertions, and add same-line granularity assertions before the final collapse. Replace lines 75-87 with:

```ts
    // One cursor inside each bold span (different lines): both reveal
    editor.setSelections([{ anchor: 8 }, { anchor: 28 }]);
    const revealed = container.textContent ?? "";
    expect(revealed).toContain("**bold**");
    expect(revealed).toContain("**also**");

    // Element-granular: two bold spans on ONE line, cursor in the first →
    // only the first reveals. Offsets: "aa **bb** cc **dd**"
    editor.setDocument("aa **bb** cc **dd**\n\nend");
    editor.setSelection(5); // inside **bb**
    const granular = container.textContent ?? "";
    expect(granular).toContain("**bb**");
    expect(granular).not.toContain("**dd**");

    // Collapse to a single cursor outside any element: both hide
    editor.setDocument("Text **bold** end\n\nother **also** line");
    editor.setSelection(18);
    const hidden = container.textContent ?? "";
    expect(hidden).toContain("bold");
    expect(hidden).toContain("also");
    expect(hidden).not.toContain("**");
    editor.destroy();
```

(The original final collapse used `setSelection(18)` on the original document; the replacement re-sets the document so offsets stay explicit.)

d) Append a nested ancestor-chain test at the end of the describe block in `live-preview-regressions.test.ts`:

```ts
  // Nested formats: the ancestor chain reveals because each ancestor's span
  // contains the head. Cursor in the italic inside bold shows both marker
  // sets; styled rendering of the content is preserved.
  it("reveals the ancestor marker chain for nested inline formats", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a **x *y* z** b\n\nend",
      livePreview: true
    });

    // "a **x *y* z** b": offset of "y" is 8
    editor.setSelection(8);
    const text = container.textContent ?? "";
    expect(text).toContain("**x *y* z**");

    // move out to the trailing " b" → all markers hidden again
    editor.setSelection(("a **x *y* z** b").length - 1);
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("*y*");
    editor.destroy();
  });
```

- [ ] **Step 2: Run tests to verify the new expectations fail**

Run: `pnpm vitest run packages/core/test/live-preview.test.ts packages/core/test/live-preview-regressions.test.ts`
Expected: FAIL — the new element-granular assertions fail (current code reveals on-line).

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/core/test/live-preview.test.ts packages/core/test/live-preview-regressions.test.ts
git commit -m "test(core): inline-format reveal contract is element-granular (failing)"
```

---

### Task 5: live-preview.ts implementation

**Files:**
- Modify: `packages/core/src/live-preview.ts` (inline branch ~lines 1220-1246)

**Interfaces:**
- Consumes: `selectionInsideSpan(from, to, heads)` from `./live-preview-ranges` (Task 1). `live-preview.ts:15` already imports from `./live-preview-ranges` — extend that import.

- [ ] **Step 1: Swap the reveal predicate**

In `packages/core/src/live-preview.ts`:

1. Extend the import at line 15:

```ts
import { collectLivePreviewRanges, selectionInsideSpan, selectionIntersects, selectionOnSameLine } from "./live-preview-ranges";
```

(`selectionOnSameLine` stays imported — still used at line 448 for heading composition.)

2. Replace the comment block + predicate at lines 1220-1231. Old:

```ts
      // Inline formatting: Decoration.replace hides the syntactic markers when
      // the cursor isn't on the same line. The inner style (bold/italic/etc.)
      // is applied via Decoration.mark on the content range REGARDLESS of
      // cursor position — that way editing a line with **bold** still shows
      // the bold rendering, just with the `**` markers visible. Without this,
      // any line under the cursor flattens to raw markup with no styling,
      // which is what made nested markers (checked task + **bold** + ~~strike~~)
      // look broken when the user was editing the line.
      const inlineStyle = getInlineMarkerStyle(range.node.type, range.source);
      if (inlineStyle && !config.renderers[range.node.type]) {
        const { openLen, closeLen, style, attrs } = inlineStyle;
        const cursorOnLine = selectionOnSameLine(range.from, range.to, doc, selection);
```

New:

```ts
      // Inline formatting: Decoration.replace hides the syntactic markers
      // unless a selection head is strictly inside this element's span
      // (element-granular reveal, PRD §4.1). Nested ancestors reveal too
      // because each ancestor span contains the head. The inner style
      // (bold/italic/etc.) is applied via Decoration.mark on the content
      // range REGARDLESS of cursor position — editing **bold** still shows
      // the bold rendering, just with the `**` markers visible.
      const inlineStyle = getInlineMarkerStyle(range.node.type, range.source);
      if (inlineStyle && !config.renderers[range.node.type]) {
        const { openLen, closeLen, style, attrs } = inlineStyle;
        const heads = selection.map((r) => r.head);
        const cursorInside = selectionInsideSpan(range.from, range.to, heads);
```

3. Update the guard two lines below — replace `if (!cursorOnLine) {` with `if (!cursorInside) {`.

- [ ] **Step 2: Run the affected suites**

Run: `pnpm vitest run packages/core/test/live-preview.test.ts packages/core/test/live-preview-regressions.test.ts`
Expected: PASS for all updated/new tests.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/live-preview.ts
git commit -m "fix(core): inline formats reveal raw syntax only for the element under the cursor"
```

---

### Task 6: Full verification

**Files:** none modified.

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm vitest run`
Expected: PASS, zero failures. If any unrelated suite fails, investigate whether it encoded line-granular behavior; fix per spec (element-granular is the contract) — do NOT weaken new assertions.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck`
Expected: no type errors (root script: `pnpm -r exec tsc --noEmit`).

- [ ] **Step 3: Manual smoke (Electron demo, click-drift invariant)**

Run the demo app, open a note with a line like `a [[Link]] b **bold** c ~~strike~~ d`:
1. Click between elements → nothing expands, click lands exactly.
2. Arrow into `[[Link]]` → only it expands; arrow out → collapses.
3. Scroll a long document, click after scrolling → caret lands on the clicked character (no drift).
4. Multi-cursor (Alt-click) inside two elements → only those two expand.

Record results in the final summary.

- [ ] **Step 4: Final commit (if any doc/test drift was fixed in Step 1-2)**

```bash
git add -A
git commit -m "test(core): verify element-granular reveal suite-wide"
```
