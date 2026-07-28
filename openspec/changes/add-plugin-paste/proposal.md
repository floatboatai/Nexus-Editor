# Change: Add `@floatboat/nexus-plugin-paste` — HTML-to-Markdown paste conversion

## Why

`@floatboat/nexus-core` already reserves a `handlers.paste` hook on
`NexusPlugin` (see `packages/core/src/types.ts` — `EditorEventHandlers`)
and dispatches paste events to plugins before falling back to its own
asset-upload logic (`packages/core/src/editor.ts` — the `paste(event)`
handler in `EditorView.domEventHandlers`). The hook is wired up, the
`EditorEventContext.insertMarkdown` helper is exposed, and yet **no
plugin consumes them**. The result: copying formatted text from a web
page, Google Docs, or Office and pasting into Nexus dumps raw HTML (or
a flattened, formatting-stripped plain-text blob) into the document.

This is a high-frequency pain point for the stated audiences —
note-taking apps, docs CMSes, LLM writing tools — where users
constantly paste research snippets, tables, and lists harvested from
the web. Every comparable editor (Obsidian, Typora, Notion) converts
rich-text paste to its native format. Nexus currently does not, and
the extension point to do so already exists in core.

A paste converter belongs in a plugin, not in core: hosts that embed
Nexus as a code-review comment box or a raw Markdown textarea (where
literal HTML should pass through untouched) should not pay the
`turndown` bundle cost. By landing it as
`@floatboat/nexus-plugin-paste`, opt-in hosts get the behaviour; core
stays lean and framework-neutral.

## What Changes

- **New package `@floatboat/nexus-plugin-paste`** under
  `packages/plugin-paste/`. Public surface:
  - `convertHtmlToMarkdown(html: string, options?: PasteConvertOptions):
    string` — pure function, no editor required. Converts an HTML
    string to Markdown using `turndown` + `turndown-plugin-gfm`
    (tables, task lists, strikethrough). Configurable: `tables`
    (default `true`), `keepInlineHtml` (default `false` — strip
    unmappable inline tags like `<span style>`, emit pure Markdown),
    `headingMaxLevel` (default `6`; deeper headings become bold
    paragraphs), `rules` (custom / override turndown rules). The
    function SHALL never throw — on conversion failure it falls back
    to tag-stripped plain text.
  - `createPastePlugin(options?: PastePluginOptions): NexusPlugin` —
    registers a `handlers.paste` hook. On each paste:
    1. If the clipboard holds **files** → `return false` (core's
       `onAssetUpload` pipeline owns image / attachment paste).
    2. If there is **no `text/html`** flavor → `return false`
       (CodeMirror's native plain-text paste runs unmodified).
    3. Otherwise run `convertHtmlToMarkdown` on the `text/html`
       payload, call `ctx.insertMarkdown(md)`, `preventDefault()`,
       `return true`.
    Adds a `shouldConvert?(event): boolean` gate for hosts that want
    to restrict conversion to specific sources.
- **No core changes.** The plugin uses only already-exported types
  (`NexusPlugin`, `EditorEventContext`, `EditorEventHandlers`) and
  the already-dispatched `handlers.paste` + `ctx.insertMarkdown`
  runtime path.
- **New runtime dependencies**: `turndown` + `turndown-plugin-gfm`.
  Both are tree-shakable ESM, ~30 KB combined. This follows the
  precedent set by `@floatboat/nexus-plugin-math` (which ships
  KaTeX, a larger dependency).

## Impact

- **Affected packages**: new `packages/plugin-paste/`; documentation
  touch-ups in root `README.md` / `README.zh.md`, `docs/ROADMAP.md` /
  `docs/ROADMAP.zh.md`, `CONTRIBUTING.md` scope whitelist,
  `tsconfig.base.json` paths, root `package.json` build script,
  `vitest.config.ts` alias.
- **No breaking changes.** Core API is untouched; the plugin is
  opt-in.
- **Bundle**: only hosts that install the plugin pay the `turndown`
  cost.
- **Tests**: 28 new tests — pure-function converter coverage (inline,
  block, GFM tables, inline-HTML handling, heading clamp, edge cases)
  + plugin integration (HTML paste inserts Markdown, plain-text
  passthrough, file-paste passthrough, `shouldConvert` gate,
  end-to-end real-DOM-event dispatch).
