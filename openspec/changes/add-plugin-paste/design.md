## Context

Two existing facts shape this design:

1. `@floatboat/nexus-core` already dispatches `paste` (and `drop`)
   DOM events to plugins via `EditorView.domEventHandlers({ paste })`
   in `packages/core/src/editor.ts`. The handler runs plugin-registered
   `handlers.paste` hooks first (`runEventHandlers`); only if none
   consume the event does core fall back to its own file/asset upload
   path. Returning `true` from a hook consumes the event (core calls
   `preventDefault` and stops dispatch); returning `false`/`undefined`
   passes through.
2. `EditorEventContext` (passed to every hook) already exposes
   `insertMarkdown(markdown: string)`, implemented as
   `view.dispatch(view.state.replaceSelection(markdown))` — exactly
   the "replace current selection" semantics a paste handler needs.
   The context deliberately does not surface CM6 internals
   (`types.ts` comment: "不直接暴露 CodeMirror 内部对象，保持插件
   API 稳定"), so the plugin must use `ctx.insertMarkdown` rather than
   reaching into the view.

So the extension point is not just present — it is purpose-built for
this use case. The plugin's job is to fill it.

## Goals / Non-Goals

- **Goals**
  - Convert rich-text (`text/html`) clipboard content to clean
    Markdown on paste — headings, bold/italic, links, lists, code
    blocks, blockquotes, GFM tables, strikethrough.
  - Never degrade the existing paste behaviour: plain-text paste and
    file/image paste must pass through untouched to core / CodeMirror.
  - Never throw — a malformed clipboard payload must not break
    pasting; it falls back to stripped text.
  - Headless: no UI, no theme, no DOM side effects beyond the
    inserted Markdown. Consistent with the project's headless
    philosophy.
  - Reusable pure function: `convertHtmlToMarkdown` works without an
    editor (Node, build scripts, workers).
- **Non-Goals**
  - No paste preview UI / confirmation dialog (hosts can layer that
    via `shouldConvert`).
  - No round-trip guarantees on the *source* HTML — we convert what
    the clipboard gives us; we do not attempt to losslessly preserve
    every CSS-styled span.
  - No core API changes. The plugin must not require a core release
    to land.
  - No Excel/Sheets-specific smart table paste beyond what
    `turndown-plugin-gfm` already handles.

## Decisions

### Decision 1: `turndown` + `turndown-plugin-gfm`, not a hand-rolled converter

A correct HTML→Markdown converter is a large surface (whitespace
collapsing, nested lists, table alignment, entity decoding). Hand-
rolling it would be thousands of lines and a permanent bug surface.
`turndown` is the de-facto standard (~6M weekly npm downloads),
tree-shakable, and `turndown-plugin-gfm` adds exactly the GFM table
behaviour Nexus's own `preset-gfm` expects. The ~30 KB cost is
acceptable: `plugin-math` already ships KaTeX (much larger), so
"plugin brings its own renderer dep" is established precedent.

### Decision 2: Files take priority over HTML

When a paste event carries both a file *and* `text/html` (some
browsers do this for copied images), the plugin MUST defer to core's
`onAssetUpload` pipeline by returning `false` before reading
`text/html`. Otherwise the plugin would race the asset uploader and
silently drop the image. This matches the design intent recorded in
`packages/core/src/lezer-markdown.ts` (`pasteURLAsLink: false` — "let
the asset-upload paste handler win").

### Decision 3: `keepInlineHtml: false` by default

Nexus's stated value prop is "Markdown text as the source of truth"
and "round-trip safe". Letting `<span style="color:red">` survive
paste would inject non-Markdown into the document, breaking that
contract. Default-stripping inline HTML keeps pasted content pure
Markdown; `keepInlineHtml: true` is the explicit opt-out for hosts
that want literal HTML.

### Decision 4: `<script>` / `<style>` always stripped

Web-clipboard HTML frequently carries `<style>` blocks (Google Docs
injects reams of CSS) and occasionally `<script>`. These are never
useful in a Markdown document. A dedicated turndown rule removes them
unconditionally (not gated by `keepInlineHtml`) — this is a safety
measure, not a style preference.

### Decision 5: Conversion failure falls back to stripped text, never throws

`convertHtmlToMarkdown` wraps `turndown` in try/catch. On any error
it returns a tag-stripped plain-text version of the input. A paste
handler that throws would break the user's paste entirely; falling
back to degraded-but-present text preserves the user's intent (get
*something* into the editor). Mirrors the wordcount plugin's "never
throws on garbage input" invariant.

### Decision 6: Heading clamp via demotion, not truncation

With `headingMaxLevel: N`, headings deeper than N are demoted to bold
paragraphs (`**text**`), not dropped or capped. Demotion preserves the
content and its relative emphasis without generating `######`-deep
nesting that would wreck the document outline. This is reversible and
predictable.
