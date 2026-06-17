## Context

Two existing facts shape this design:

1. `@floatboat/nexus-core` already parses the document to **mdast** on
   every change (see `packages/core/src/editor.ts` — debounced `parse`
   into the `Root` AST cached on the API), and exposes the parsed AST
   via `editor.getAst()`. A wordcount plugin that re-parses the
   document for itself would double the parsing cost on every
   keystroke.
2. `EditorAPI.getDocumentStats()` exists but is naive — it does
   `doc.trim().split(/\s+/)` on the raw Markdown source. We must not
   silently change that API's semantics; existing consumers may have
   built on the current behaviour. The new plugin is a *layer*, not
   a replacement.

## Goals / Non-Goals

- **Goals**
  - First-class CJK support (per-character counting by default) so
    Chinese / Japanese / Korean documents report meaningful numbers.
  - Markdown-aware exclusions (code, math, HTML, frontmatter,
    footnote / link definitions).
  - Selection stats updated synchronously while full-doc stats are
    debounced.
  - Reading-time estimate that uses different rates for Latin words
    vs. CJK characters (a 1,000-character Chinese paragraph is read
    in ~2 minutes, not ~4).
  - Zero new external dependencies — read the AST `core` already
    produces.
  - Optional status-bar UI that's framework-agnostic and ARIA-live.
- **Non-Goals**
  - Per-heading word counts (TOC-style). Trivial to layer on top
    later; left out to keep v1 surface small.
  - Locale-aware sentence segmentation (`Intl.Segmenter` with
    `granularity: "sentence"`). We expose a heuristic and document its
    limits; hosts can swap in their own segmenter in a v2.
  - Replacing `EditorAPI.getDocumentStats()` — would be a public-API
    semantic break. Left for a separate proposal.

## Decisions

### Decision 1: New plugin package, not a core enhancement

`@floatboat/nexus-plugin-wordcount` lives in `packages/plugin-wordcount/`.

**Alternatives considered:**

- *Extend `core.getDocumentStats()` to be Markdown-aware.* Would
  change the semantics of an existing public method (e.g. a Notion
  embed that relies on the current naive count would see different
  numbers). Even if we add new fields, current consumers reading
  `words` would silently shift. Rejected: breaks SemVer expectation
  on an unversioned beta API more than necessary.
- *Drop it into `preset-gfm`.* The preset is about Markdown
  extensions (tables, task lists), not statistics. Mixing in a
  cross-cutting capability would muddy the package's purpose.
  Rejected.
- *Headless utility only (no plugin / status bar).* Loses the
  out-of-the-box "drop in and see counts" affordance. The bar is
  cheap (few dozen DOM nodes) and trivially opt-in via
  `statusBar: false`. Rejected.

The plugin package mirrors `plugin-history` exactly: ESM-only build
with `tsup`, workspace dep on `@floatboat/nexus-core`, no deps on
other plugins.

### Decision 2: Read the AST `core` already parsed, never re-parse

`createWordCountPlugin` reads the document via `editor.getDocument()`
and the AST via `editor.getAst()`. Both are already maintained by
core; no remark / unified packages are added to the plugin's
dependency closure.

The *pure function* `countMarkdown(source, options)` accepts an
optional `ast` in `options`. When omitted, it lazily constructs a
minimal `unified().use(remarkParse).use(remarkGfm).use(remarkMath)`
pipeline so the function remains useful standalone (e.g. in a
Node-side build script counting words across a vault). The plugin
always passes `ast`, so the lazy pipeline is never instantiated at
runtime in the editor — pay-only-if-you-use.

**Alternatives considered:**

- *Re-parse inside the plugin.* Doubles parse cost and risks AST
  drift if core's parser config diverges. Rejected.
- *Skip the AST and regex-strip Markdown.* Brittle — e.g. stripping
  fenced code via `/```[\s\S]*?```/g` mishandles nested backticks
  and indented code blocks. AST is the right tool. Rejected.

### Decision 3: CJK characters count as words by default

`cjkUnit: "char"` (default) means each `\p{Script=Han}` / Hiragana /
Katakana / Hangul codepoint contributes one word to the total. This
matches Word, Notion, Bear, Obsidian. An opt-out (`cjkUnit: "word"`)
collapses consecutive CJK runs into one "word" for hosts that want
to align with Microsoft Office's pre-2007 behaviour.

**Why two regimes and not just "always character":** some hosts
write app contracts like "word limit on a comment thread" that
should not bite Chinese authors twice as hard. Exposing the toggle
costs nothing.

### Decision 4: Reading-time uses two rates

```
seconds = ceil(latinWords / wpm * 60 + cjkCharacters / cpm * 60)
```

with `wpm = 238` (Brysbaert 2019 silent-reading average for English
prose) and `cpm = 500` (typical Chinese silent-reading rate cited in
multiple usability studies, intentionally on the conservative side).
Both overridable via `options.readingSpeed`.

A single WPM rate over-counts Chinese reading time by ~2×; a single
CPM rate under-counts English. Combining the two on the same axis is
the standard solution (see Medium, Substack, JuejinCN's read-time
estimators).

### Decision 5: Selection sync, full-doc debounced

`change` events fire on every keystroke — running an mdast walk per
keystroke is wasteful when the user can only read the bar at ~3 Hz
anyway. Default `debounceMs: 150` matches the existing
`parseDelayMs` in core.

`selectionChange` recomputes selection stats **synchronously**
because:
- selection events are coarse (only fire on movement, not typing);
- selection slices are usually small (< 1 KB);
- the user expects "selected: 47 words" to update *now* when they
  drag-select a sentence.

The plugin parses the **slice** with the lazy pipeline (the only
runtime use of it). For typical selection sizes the cost is
negligible.

### Decision 6: Status bar uses `aria-live="polite"`, not `assertive`

Word counts change often. `assertive` would interrupt screen-reader
output on every keystroke (after debounce — still many times per
minute). `polite` is the right contract: announce when idle, never
interrupt.

The bar's items also expose plain text content so any host CSS can
restyle without breaking the announcement.

### Decision 7: Plugin returns a hybrid object (NexusPlugin + handle)

`createWordCountPlugin(options)` returns the `NexusPlugin` literal
augmented with `getStats / getSelectionStats / subscribe / destroy`
**directly on the returned object**.

```ts
const wordcount = createWordCountPlugin();
createEditor({ container, plugins: [wordcount] });
wordcount.subscribe(({ doc, selection }) => render(doc, selection));
```

**Why not a tuple `[plugin, api]`?** Less ergonomic — every caller
has to destructure or hold two references. The hybrid object is what
`plugin-slash` does for its menu UI (`createSlashMenuUI` returns
`{ element, destroy }` — same idiom of "thing you mounted" + "thing
you query / tear down").

The augmented fields are non-enumerable on `NexusPlugin`'s type, so
core's plugin-registration code (which only reads `name`,
`cmExtensions`, etc.) ignores them — no risk of accidental
serialisation.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Lazy parser dep tree creeps into the plugin's published bundle even when callers always pass `ast`. | Use a dynamic `import("unified")` inside the lazy path; the bundler tree-shakes it away when the plugin is only used through the editor. We pay a one-shot ~80 KB cost only on standalone `countMarkdown(source)` calls. |
| Status bar absolute-positioned over editor content masks scrollbars in some hosts. | Default placement is the bottom-right of the editor container; expose `container` option to move it to a host-owned slot. The Electron demo uses a separate footer. |
| `Intl.NumberFormat` may differ in test envs (jsdom) vs. production (Chromium). | Tests assert on the raw stats object, not the rendered string. Locale-affected rendering is covered by a single snapshot-style assertion that strips the digit-group separator. |
| Heuristic sentence count is wrong for abbreviations ("e.g.", "Dr."). | Documented as heuristic; expose a future `options.sentenceSegmenter` hook; ship a test that covers the common false-positive (`"e.g. and"` should be 1 sentence, currently reports 2). Acceptable for v1; flagged in README. |
| Adding a new package slows monorepo CI by one more build step. | The package is < 200 LOC source, builds in well under a second; the parallel `pnpm -r build` absorbs it without measurable wall-clock impact. |

## Migration Plan

No migration. New package; existing code unaffected. The first
release of `@floatboat/nexus-plugin-wordcount` follows the same
`0.0.x` baseline as the other workspace packages, published from the
maintainers' `pnpm publish:packages` workflow.

## Open Questions

- Should the status bar default to mounting in
  `editor.getCoordsAtPos(0)`'s positioned ancestor, or always
  `document.body`? Current decision: the ancestor (avoids leaking
  into the host's z-index space). Open to flipping if reviewers
  prefer the React-portal-style "always body" model.
- Reading-time `wpm` / `cpm` defaults — happy to move both to lower
  conservative numbers (200 / 400) if maintainers prefer
  pessimism over realism.
