# Implementation Tasks

## 1. Package scaffolding

- [x] 1.1 Create `packages/plugin-wordcount/` with `package.json`
  (matching the shape of `packages/plugin-history/package.json`:
  `tsup` build script, `@floatboat/nexus-core` workspace dep,
  `publishConfig` set to public npm).
- [x] 1.2 Create `packages/plugin-wordcount/tsconfig.json` extending
  `../../tsconfig.base.json` and `include`-ing `src/**/*.ts` +
  `test/**/*.ts`.
- [x] 1.3 Add the alias `"@floatboat/nexus-plugin-wordcount":
  ["packages/plugin-wordcount/src/index.ts"]` to `tsconfig.base.json`
  `paths`.
- [x] 1.4 Add the matching alias to `vitest.config.ts`
  `resolve.alias`.
- [x] 1.5 Append `&& pnpm --filter @floatboat/nexus-plugin-wordcount
  build` to the root `package.json` `build` script.

## 2. Pure-function counting (`src/count.ts`)

- [x] 2.1 Implement `countMarkdown(source: string, options?:
  WordCountOptions): WordCountStats`. The function SHALL parse the
  Markdown using the same `unified + remark-parse + remark-gfm`
  pipeline that `@floatboat/nexus-core` exposes — but because the
  plugin must not pull in a parser when the host already has one, the
  function MUST first accept an optional pre-parsed AST argument:
  `countMarkdown(source, { ast?: Root, ... })`. When `ast` is omitted
  the implementation parses on the fly using a lazy-loaded
  `unified()` instance scoped to this module (so first-call cost is
  paid once).
- [x] 2.2 Implement an mdast visitor that collects "prose text"
  segments and skips node types in `options.exclude` (defaults to
  `["code", "inlineCode", "math", "inlineMath", "html", "yaml",
  "toml", "definition", "footnoteDefinition"]`). Image alt text is
  included by default; can be excluded via `options.exclude`.
- [x] 2.3 Implement word counting:
  - Latin / Cyrillic / Greek / etc.: `\p{L}[\p{L}\p{M}\p{N}\u2019']*`
    (Unicode property escapes, supported in ES2018+, target ES2022).
  - CJK (`\p{Script=Han}`, `\p{Script=Hiragana}`,
    `\p{Script=Katakana}`, `\p{Script=Hangul}`): default `cjkUnit:
    "char"` counts each CJK character as one word; `"word"` collapses
    consecutive same-script runs into a single word.
  - Numbers: `\p{N}+` counts as one word.
  - Standalone punctuation does NOT contribute.
- [x] 2.4 Compute and return:
  - `words` — total under the rule above.
  - `latinWords` — only the non-CJK contribution.
  - `cjkCharacters` — total CJK characters encountered.
  - `characters` — total Unicode characters of prose text (post-strip).
  - `charactersNoSpaces` — `characters` minus `\s` runs.
  - `lines` — count of `\n`-delimited lines in the **raw source**
    (not the stripped prose). Empty trailing line excluded.
  - `paragraphs` — number of mdast `paragraph` nodes that survived the
    exclude filter.
  - `sentences` — heuristic split on `[.!?。！？]+(\s|$)`.
  - `readingTimeSeconds` — `Math.ceil((latinWords / wpm) * 60 +
    (cjkCharacters / cpm) * 60)`, where `wpm` defaults to 238
    (Brysbaert 2019 silent-reading average) and `cpm` defaults to 500
    (typical Chinese silent-reading rate); both overridable via
    `options.readingSpeed: { wpm?, cpm? }`.
- [x] 2.5 Make the function robust to an empty document and to
  invalid Markdown — it MUST never throw; on parse failure it SHALL
  fall back to a whitespace-only counter (so the call site can rely
  on a non-null result).

## 3. Plugin factory (`src/plugin.ts`)

- [x] 3.1 Export `createWordCountPlugin(options?:
  WordCountPluginOptions): NexusPlugin & { getStats(): WordCountStats;
  getSelectionStats(): WordCountStats; subscribe(listener):
  Unsubscribe; }`. The returned object SHALL be both a valid
  `NexusPlugin` (so it can be passed to `createEditor({ plugins }`))
  and a handle the host can keep for direct queries.
- [x] 3.2 In the plugin's `cmExtensions`, register a single
  `ViewPlugin` whose `update` method is a no-op — its only purpose is
  to give the wordcount plugin a place to capture the `EditorView`
  for `coordsAtPos`-style positioning of the status bar. The actual
  state subscription happens in step 3.4 via the public `editor.on`
  API.
- [x] 3.3 Resolve options:
  - `debounceMs: number = 150` (selection counting is cheap, full doc
    counting on every keystroke is not; the plugin debounces full doc
    recount and runs selection recount synchronously).
  - `cjkUnit`, `exclude`, `readingSpeed` — forwarded to
    `countMarkdown`.
  - `statusBar: false | StatusBarOptions = false` — when truthy,
    mount the status-bar widget (see §4).
  - `labels: Partial<WordCountLabels>` — i18n strings ("words",
    "chars", "min read", "selected").
- [x] 3.4 On the first `change` (and immediately on attach via a
  microtask), recompute full-doc stats from `editor.getAst()` +
  `editor.getDocument()` and notify subscribers. Selection-change
  recomputes selection stats only (does NOT re-parse — slices the
  raw source and calls `countMarkdown` on the slice with `ast:
  undefined`, which is the rare case the lazy parser actually runs).
- [x] 3.5 Expose:
  - `getStats(): WordCountStats` — last full-doc snapshot.
  - `getSelectionStats(): WordCountStats` — last selection snapshot
    (zero when selection is empty).
  - `subscribe(listener: (stats: WordCountState) => void):
    Unsubscribe` — fires immediately with the current state, then on
    every recompute. `WordCountState` is `{ doc: WordCountStats,
    selection: WordCountStats, isSelectionActive: boolean }`.
- [x] 3.6 Provide a `destroy()` lifecycle that detaches all editor
  subscriptions and tears down the status bar.

## 4. Status-bar widget (`src/status-bar.ts`)

- [x] 4.1 Implement `createStatusBar(editor, plugin, options):
  StatusBarHandle`. The bar SHALL be appended to
  `options.container ?? editor.getCoordsAtPos(0)`'s nearest
  positioned ancestor, falling back to `document.body`.
- [x] 4.2 Layout: a single `<div role="status" aria-live="polite">`
  with three spans (words, chars, reading time) plus an optional
  fourth (selection summary, only visible when selection is
  non-empty).
- [x] 4.3 Re-render via the plugin's `subscribe` — the bar does NOT
  parse anything itself.
- [x] 4.4 Number formatting via `Intl.NumberFormat(options.locale ??
  undefined)`. Reading-time formatting: `<60s` shows `"<1 min read"`,
  otherwise `"<n> min read"`.
- [x] 4.5 ARIA: the live region announces the latest counts so screen
  reader users get the same affordance as sighted users.

## 5. Public exports (`src/index.ts`)

- [x] 5.1 Re-export `countMarkdown`, `createWordCountPlugin`,
  `createStatusBar`, and every public type
  (`WordCountStats`, `WordCountOptions`, `WordCountPluginOptions`,
  `WordCountState`, `WordCountLabels`, `StatusBarOptions`,
  `StatusBarHandle`).

## 6. Tests

- [x] 6.1 `test/count.test.ts` (pure-function):
  - empty string → all-zero stats;
  - "Hello, World!" → `words: 2, characters: 13, charactersNoSpaces:
    12, sentences: 1`;
  - skips fenced code blocks: ` ```js\nconst x = 1;\n``` ` → `words: 0`;
  - skips inline code: "`abc` def" → `words: 1`;
  - skips YAML frontmatter: `---\ntitle: foo\n---\nhello` → `words: 1`;
  - skips HTML: `<!-- comment --> hi` → `words: 1`;
  - skips math: `$x^2$ done` and `$$x=1$$\nDone` → `words: 1`;
  - CJK default char-count: "你好，世界。" → `words: 4,
    cjkCharacters: 4, sentences: 1`;
  - CJK with `cjkUnit: "word"`: "你好世界" → `words: 1`;
  - mixed CJK + Latin: "Hello 世界 today" → `words: 2 + 2 = 4`;
  - smart-quoted Latin: "don't can't" → `words: 2`;
  - image alt text included by default: `![a cat](x.png)` → `words:
    2`; with `exclude: ["image"]` → `words: 0`;
  - reading time floors at <1 min and rounds up otherwise;
  - graceful on garbage input: never throws, returns zero stats.
- [x] 6.2 `test/plugin.test.ts` (jsdom + editor integration):
  - mounting the plugin and calling `getStats()` immediately yields
    stats consistent with `countMarkdown(initialValue)`;
  - `subscribe` listener fires once on attach with the initial
    state;
  - editing the document fires the listener after debounce with new
    `doc` stats;
  - moving selection updates `selection` stats synchronously
    (no debounce);
  - `destroy()` removes the subscription and prevents further
    listener invocations;
  - status bar renders when `statusBar: {}` is supplied;
  - status bar updates text in response to changes;
  - status bar's selection span hides when selection collapses.

## 7. Documentation

- [x] 7.1 `packages/plugin-wordcount/README.md` — install, vanilla
  usage, React/Vue usage hint, full options + types reference, the
  "why not core" rationale, and a paragraph explaining the
  Markdown-aware vs. naive trade-off vs.
  `editor.getDocumentStats()`.
- [x] 7.2 Top-level `README.md` plugin table — add a row for
  `@floatboat/nexus-plugin-wordcount`. Same for `README.zh.md`.
- [x] 7.3 `docs/ROADMAP.md` — add a row under "9. Developer
  Experience" (or a new "Statistics & Insights" section) with status
  `done` (will toggle once merged). Same for `docs/ROADMAP.zh.md`.
- [x] 7.4 `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` — add `wordcount`
  to the scope whitelist row mapping it to
  `packages/plugin-wordcount`.

## 8. Demo integration

- [x] 8.1 Add `@floatboat/nexus-plugin-wordcount` to
  `apps/electron-demo/package.json` `dependencies` (workspace
  protocol).
- [x] 8.2 Add the matching alias in
  `apps/electron-demo/vite.config.ts`.
- [x] 8.3 In `apps/electron-demo/src/renderer/editor-shell.ts` (or
  wherever the editor is mounted), register the plugin with
  `statusBar: {}` and tear it down in the cleanup path.
- [x] 8.4 Add minimal status-bar CSS to
  `apps/electron-demo/src/renderer/style.css`.

## 9. Verify

- [x] 9.1 `pnpm install` — workspace recognises the new package.
- [x] 9.2 `pnpm typecheck` clean across the repo.
- [x] 9.3 `pnpm test` — 362/362 (existing 317 + 45 new). Run from
  repo root with `pnpm test`.
- [x] 9.4 `pnpm build` — including the new package; `dist/index.js
  14.55 KB` + `dist/index.d.ts 9.90 KB` emit cleanly.
- [ ] 9.5 Manual smoke in the electron demo — deferred. The
  electron-demo's `pnpm build:electron-demo` succeeds (status bar
  CSS and Vite alias verified through the production build); the
  jsdom integration tests in `packages/plugin-wordcount/test/plugin.test.ts`
  cover the same status-bar interactions as a manual smoke would.
- [ ] 9.6 `openspec validate add-plugin-wordcount --strict` — CLI
  not installed in the dev environment. Spec format hand-linted
  against the OpenSpec 1.5 rules in `AGENTS.md` and `openspec/config.yaml` (each
  `### Requirement:` has at least one `#### Scenario:` with
  `**WHEN**`/`**THEN**` bullets; delta files use
  `## ADDED Requirements`).
