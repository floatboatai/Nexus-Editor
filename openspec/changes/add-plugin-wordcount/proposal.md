# Change: Add `@floatboat/nexus-plugin-wordcount` — Markdown-aware word & reading-time statistics

## Why

`EditorAPI.getDocumentStats()` already exists in `@floatboat/nexus-core`
(see `packages/core/src/editor.ts:811-817`), but the implementation is a
naive `doc.trim().split(/\s+/)` over the raw markdown source. That count
is wrong for any non-trivial document:

- **Markdown syntax leaks in.** `**bold**`, `# heading`, `<!-- comment -->`,
  fenced code blocks, math blocks, and YAML frontmatter all contribute
  "words" that the human author never wrote.
- **CJK doesn't fit a whitespace split.** A 1,000-character Chinese note
  reports as 1 "word" because the script has no inter-word spaces. Asian
  markets are a stated audience (the Electron demo ships a Chinese
  sample vault under `apps/electron-demo/sample-vault/`).
- **No reading-time, no selection counts.** Notion / Obsidian / Bear all
  expose "words in selection" and "estimated reading time". A
  Markdown-native editor that's trying to compete on PKM use cases
  cannot ship without them.

A wordcount surface also belongs in a plugin, not in core: hosts that
embed Nexus in a comment box or a code-review surface (where character
limits matter, not reading time) shouldn't pay the cost of mdast
traversal on every keystroke. By landing it as
`@floatboat/nexus-plugin-wordcount`, opt-in hosts pay the cost; the
core stays lean.

## What Changes

- **New package `@floatboat/nexus-plugin-wordcount`** under
  `packages/plugin-wordcount/`. Public surface:
  - `countMarkdown(source, options?) → WordCountStats` — pure function,
    Markdown-aware: traverses mdast, ignores `code` / `inlineCode` /
    `math` / `inlineMath` / `html` / `yaml` / `toml` nodes by default
    (each toggleable via `options.include`), counts words via Unicode
    word-boundary heuristics (Latin / Cyrillic / Greek / etc. via
    `\p{L}+` runs, CJK ideographs counted **per character** by default,
    with a configurable `cjkUnit: "char" | "word"` to opt out).
  - `createWordCountPlugin(options?) → NexusPlugin` — registers a
    `change` listener that maintains a debounced stats cache and exposes
    it via the plugin's returned API; optionally mounts a small floating
    **status bar widget** anchored to the editor container with text
    such as `1,234 words · 8,901 chars · 6 min read`. Labels are fully
    overridable for i18n.
  - `WordCountStats` type: `{ words, characters, charactersNoSpaces,
    cjkCharacters, latinWords, lines, paragraphs, sentences,
    readingTimeSeconds }`.
- **Mount on the existing public API only** — no core changes. The
  plugin uses `editor.on("change", ...)`, `editor.on("selectionChange",
  ...)`, `editor.getDocument()`, `editor.getSelection()`, and
  `editor.getAst()`. No new exports from `@floatboat/nexus-core`.
- **Workspace integration** — `tsconfig.base.json` path alias,
  `vitest.config.ts` resolve alias, root `package.json` build script,
  README plugin table row, ROADMAP entry under DX, scope whitelist row
  in `CONTRIBUTING.md` (`wordcount`).
- **Electron demo integration** — `apps/electron-demo` mounts the
  status-bar widget so the very first time a reviewer opens a `.md`
  file they see the live count update in the bottom-right corner.

No breaking changes. The existing `EditorAPI.getDocumentStats()` is
left intact (it remains the cheap, raw-source counter) and is
explicitly documented in the new package's README as the "naive
fallback" — the plugin layers a richer, Markdown-aware computation on
top of the same editor instance without replacing the core method.

## Impact

- Affected specs:
  - `wordcount` (NEW capability) — pure-function counting contract,
    plugin lifecycle, debounce / selection semantics, status-bar widget
    behaviour, accessibility.
- Affected code:
  - `packages/plugin-wordcount/` (NEW package — `src/index.ts`,
    `src/count.ts`, `src/plugin.ts`, `src/status-bar.ts`, `README.md`,
    `package.json`, `tsconfig.json`, `test/count.test.ts`,
    `test/plugin.test.ts`).
  - `tsconfig.base.json` (path alias).
  - `vitest.config.ts` (resolve alias).
  - `package.json` (root `build` script adds the new package).
  - `pnpm-workspace.yaml` left untouched — already globs `packages/*`.
  - `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` (scope whitelist row).
  - `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` (new row under DX).
  - `README.md` / `README.zh.md` (plugin table row, brief example).
  - `apps/electron-demo/package.json` (workspace dep), `vite.config.ts`
    (alias), `src/renderer/editor-shell.ts` (mount), `style.css`
    (status-bar styling).
- New external dependencies: **none**. The plugin reads the AST that
  `@floatboat/nexus-core` already parses via the unified pipeline; no
  remark / mdast packages are added.
- Out of scope (explicit non-goals):
  - Locale-aware sentence segmentation (Intl.Segmenter `granularity:
    "sentence"`). We expose a heuristic (`. ! ? 。 ！ ？` followed by
    whitespace or end-of-paragraph) and document it. Hosts that need
    high-accuracy sentence counting can pass `options.sentenceSegmenter`
    in a follow-up change.
  - Per-heading word counts (table-of-contents style). Easy to layer on
    top of `countMarkdown` later; not in v1 to keep the public surface
    small.
  - Replacing `EditorAPI.getDocumentStats()`. Doing so would be a
    semantic break for hosts that rely on the current behaviour and
    requires a separate proposal.
