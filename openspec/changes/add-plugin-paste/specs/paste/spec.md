# Paste Plugin Spec — HTML-to-Markdown paste conversion

## ADDED Requirements

### Requirement: HTML-to-Markdown Conversion Function

The package SHALL export `convertHtmlToMarkdown(html: string,
options?: PasteConvertOptions): string`. The function SHALL convert
an HTML string to Markdown using `turndown` configured with ATX
headings, `-` bullet markers, fenced code blocks, `*` emphasis, `**`
strong, and inlined links. The function SHALL never throw — on
conversion failure it SHALL fall back to a tag-stripped plain-text
representation and return that.

#### Scenario: Empty input returns empty string
- **WHEN** `convertHtmlToMarkdown("")` or
  `convertHtmlToMarkdown("   ")` is invoked
- **THEN** the result SHALL equal `""`

#### Scenario: Inline bold and italic
- **WHEN** `convertHtmlToMarkdown("<b>hi</b>")` is invoked
- **THEN** the result SHALL equal `"**hi**"`
- **AND** `convertHtmlToMarkdown("<i>hi</i>")` SHALL equal `"*hi*"`

#### Scenario: Anchor becomes inlined link
- **WHEN** `convertHtmlToMarkdown('<a href="https://x.com">link</a>')`
  is invoked
- **THEN** the result SHALL equal `"[link](https://x.com)"`

#### Scenario: GFM table conversion
- **WHEN** the input is a `<table>` with header row `A`, `B` and body
  row `1`, `2`
- **THEN** the result SHALL contain `"| A | B |"`, a `"| --- |"`
  separator, and `"| 1 | 2 |"`

#### Scenario: tables disabled opts out of GFM tables
- **WHEN** the input is a `<table>` and `convertHtmlToMarkdown(html,
  { tables: false })` is invoked
- **THEN** the result SHALL NOT contain a `"| --- |"` separator row

#### Scenario: Script and style always stripped
- **WHEN** the input contains `<style>.x{color:red}</style>` and
  `<script>alert(1)</script>` alongside visible text
- **THEN** the result SHALL contain the visible text
- **AND** SHALL NOT contain `"alert"` or `"color:red"`

#### Scenario: Garbage input never throws
- **WHEN** `convertHtmlToMarkdown` is invoked with any malformed
  string (e.g. `"<<<>>>"`, `"<unclosed"`)
- **THEN** the function SHALL NOT throw
- **AND** SHALL return a string

### Requirement: Inline HTML Handling

By default (`keepInlineHtml: false`, the default), the converter
SHALL strip unmappable inline style tags (`span`, `font`, `mark`,
`small`, `sub`, `sup`) down to their text content. When
`keepInlineHtml: true` is supplied, the converter SHALL emit those
tags verbatim with their attributes preserved.

#### Scenario: Default strips span
- **WHEN** `convertHtmlToMarkdown('<span style="color:red">text</span>')`
  is invoked
- **THEN** the result SHALL equal `"text"`

#### Scenario: keepInlineHtml preserves span
- **WHEN** `convertHtmlToMarkdown('<span style="color:red">text</span>',
  { keepInlineHtml: true })` is invoked
- **THEN** the result SHALL contain `"<span"`

### Requirement: Heading Level Clamp

`headingMaxLevel` (default `6`, clamped to the range `[1, 6]`) SHALL
cap the deepest heading level emitted. Headings whose level exceeds
`headingMaxLevel` SHALL be demoted to a bold paragraph (`**content**`)
rather than dropped.

#### Scenario: Deep heading demoted to bold
- **WHEN** `convertHtmlToMarkdown("<h3>deep</h3>", { headingMaxLevel: 2 })`
  is invoked
- **THEN** the result SHALL contain `"**deep**"`
- **AND** SHALL NOT match `/^###\s/`

### Requirement: Plugin Factory and Paste Hook Contract

The package SHALL export `createPastePlugin(options?:
PastePluginOptions): NexusPlugin`. The returned object SHALL be a
valid `NexusPlugin` with `name: "plugin-paste"` and a `handlers.paste`
hook. `PastePluginOptions` SHALL extend `PasteConvertOptions` with an
optional `shouldConvert?: (event: ClipboardEvent) => boolean` gate.

The `handlers.paste` hook SHALL implement this contract, in order:

1. If the clipboard carries files → return `false` (defer to core's
   `onAssetUpload`).
2. If `event.clipboardData.getData("text/html")` is empty → return
   `false` (let CodeMirror's plain-text paste run).
3. If `options.shouldConvert` is set and returns `false` for this
   event → return `false`.
4. Otherwise convert the HTML; if the result is non-empty, call
   `event.preventDefault()`, `ctx.insertMarkdown(md)`, and return
   `true`; if the result is empty, return `false`.

Returning `true` SHALL be treated by core as "event consumed"
(prevent default, stop dispatch); returning `false`/`undefined` SHALL
pass the event through to core's default behaviour.

#### Scenario: HTML paste converts and inserts Markdown
- **WHEN** an editor is created with `plugins: [createPastePlugin()]`
  and a paste event carrying `text/html` `"<h1>Title</h1><p>Body
  <b>bold</b></p>"` is dispatched to the editor's content element
- **THEN** the document SHALL contain `"# Title"` and `"**bold**"`
- **AND** SHALL NOT contain `"<h1>"` or `"<strong>"`
- **AND** the paste event's `preventDefault` SHALL have been called

#### Scenario: Plain-text paste passes through
- **WHEN** a paste event carries `text/plain` but no `text/html`
- **THEN** the hook SHALL return `false`
- **AND** `preventDefault` SHALL NOT have been called
- **AND** the document SHALL NOT be rewritten by the plugin

#### Scenario: File paste defers to core
- **WHEN** a paste event carries a file (e.g. an image) even if
  `text/html` is also present
- **THEN** the hook SHALL return `false`
- **AND** `preventDefault` SHALL NOT have been called

#### Scenario: shouldConvert gate rejects conversion
- **WHEN** the plugin is created with `shouldConvert: () => false`
  and a paste event carrying `text/html` is dispatched
- **THEN** the hook SHALL return `false`
- **AND** the document SHALL be unchanged by the plugin

#### Scenario: Empty conversion passes through
- **WHEN** the `text/html` payload converts to an empty string
- **THEN** the hook SHALL return `false`
- **AND** `ctx.insertMarkdown` SHALL NOT have been called

### Requirement: Standalone Pure-Function Reuse

`convertHtmlToMarkdown` SHALL be usable without an editor instance —
in Node, build scripts, or workers — and SHALL produce output
consistent with the in-editor paste path for the same HTML input and
options.

#### Scenario: Standalone call matches in-editor conversion
- **WHEN** `convertHtmlToMarkdown("<ul><li>a</li><li>b</li></ul>",
  { tables: true })` is invoked standalone
- **AND** the same HTML is pasted through `createPastePlugin({
  tables: true })` into an editor
- **THEN** the editor's document SHALL equal the standalone return
  value
