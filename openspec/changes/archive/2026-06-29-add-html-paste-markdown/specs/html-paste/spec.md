## ADDED Requirements

### Requirement: Convert pasted HTML to Markdown

The paste plugin SHALL convert pasted rich-text/HTML clipboard content into Markdown and insert it at the current selection, using the editor's Markdown conventions.

#### Scenario: Paste formatted HTML

- **WHEN** the clipboard contains `text/html` with formatting (bold, links, headings, lists) and no files
- **THEN** the inserted text SHALL be the Markdown equivalent (`**bold**`, `[text](url)`, ATX `# heading`, `- item`)
- **AND** the original HTML SHALL NOT be inserted as raw markup

#### Scenario: A hyperlink keeps its URL

- **WHEN** the clipboard HTML is an anchor whose visible text equals the `text/plain` (e.g. `<a href="https://example.com">Example</a>`)
- **THEN** the plugin SHALL convert it to `[Example](https://example.com)` (it SHALL NOT fall through on text-equality)

#### Scenario: GFM constructs and editor conventions

- **WHEN** the pasted HTML contains a table, strikethrough, task list, an `<h1>`, or a code block
- **THEN** the output SHALL use GFM syntax and the editor's conventions: ATX heading (`# …`), fenced code (language preserved), `-` bullets, `**` strong

### Requirement: Determine convertibility by formatting structure

The plugin SHALL consume the paste only when the sanitized HTML contains a formatting/structural element, and SHALL fall through otherwise. The consume decision SHALL be made synchronously (the handler returns a boolean, never a Promise).

#### Scenario: Plain-text paste is unchanged

- **WHEN** the clipboard has only `text/plain`
- **THEN** the plugin SHALL NOT consume the event and the default plain-text paste SHALL occur

#### Scenario: HTML with no formatting falls through

- **WHEN** the `text/html` has no formatting/structural element (plain text wrapped in `<html>`/`<meta>`/`<p>`/`<div>`/`<span>`)
- **THEN** the plugin SHALL NOT consume the event

### Requirement: Never interfere with file/image paste

The plugin SHALL fall through whenever the clipboard contains files, preserving the host upload path.

#### Scenario: Any file in the clipboard falls through

- **WHEN** the clipboard contains a file (via `clipboardData.files` or `clipboardData.items` kind==="file"), regardless of also-present HTML
- **THEN** the plugin SHALL NOT consume the event and the host's `onAssetUpload` SHALL run

### Requirement: Handle images via the host upload pipeline (v1)

In v1 the plugin SHALL route `data:` images through the host upload pipeline (the save-to-local default) and SHALL NOT inline image bytes; remote images are kept as links. All image uploads SHALL be awaited with per-image best-effort before a single Markdown insertion (no in-document placeholders).

#### Scenario: Remote image becomes a Markdown link

- **WHEN** the pasted HTML contains `<img src="https://…">`
- **THEN** the output SHALL contain `![alt](https://…)` (no fetch, no upload)

#### Scenario: data: image is uploaded, not inlined

- **WHEN** the pasted HTML contains `<img src="data:image/png;…">` (a supported raster type)
- **THEN** the image bytes SHALL be decoded to a file and routed through `ctx.uploadAsset`, and the inserted Markdown SHALL reference the returned URL
- **AND** the image SHALL NOT be inlined as a base64 blob
- **AND** all uploads SHALL be awaited and the converted Markdown inserted once (a single insertion / single undo entry)
- **AND** if one image's upload returns null or fails, only that image SHALL be omitted — the other images and the surrounding text SHALL still be inserted

#### Scenario: Non-raster data: URI is not uploaded

- **WHEN** an `<img src="data:…">` carries a non-raster MIME (e.g. `data:text/html`, `data:image/svg+xml` — only `image/png`/`jpeg`/`gif`/`webp` are supported)
- **THEN** the plugin SHALL NOT decode or upload it, and it SHALL be omitted from the inserted Markdown

#### Scenario: Decoded image filename cannot carry a path

- **WHEN** the plugin decodes a `data:` image to a `File` to hand to `ctx.uploadAsset`
- **THEN** the synthesized `File` name SHALL be a safe basename (no path separators, no `..`, no NUL), with the extension derived from the validated raster MIME — so the plugin can never originate a path-traversal payload to a host

### Requirement: Sanitize untrusted HTML and keep emitted Markdown syntactically safe

The plugin SHALL sanitize incoming HTML and SHALL guarantee that converted link/image destinations — and the alt/title text surrounding them — cannot break Markdown syntax or carry a disallowed URL scheme.

#### Scenario: Executable and unsafe content is removed

- **WHEN** the HTML contains `<script>`/`<iframe>`/`<object>`, an inline `on*` handler, an `<svg>`/`<svg><image xlink:href="data:…">`, an `<img onerror>`, or a link with a non-allowlisted scheme (`javascript:`, `data:` on a link, `vbscript:`)
- **THEN** none SHALL appear in the inserted Markdown, and none SHALL execute or fetch a resource during paste handling

#### Scenario: Destination cannot break Markdown syntax

- **WHEN** the HTML contains `<img src="/x)[t](javascript:alert(1))">` or `<a href="https://x)[c](javascript:alert(1))">t</a>` (or a link/image URL containing `(`, `)`, `[`, `]`, `<`, `>`, or spaces), or a protocol-relative `<a href="//evil.com">` / backslash-authority `<a href="/\evil.com">`
- **THEN** the converted output SHALL NOT produce an additional link/image, any `javascript:`-scheme destination, or a protocol-relative/backslash-authority (`//host`, `/\host`) destination
- **AND** every emitted HTML-derived link/image destination SHALL be scheme-allowlisted (http/https/mailto/path-relative, rejecting `//host` and `/\host` via URL-parser classification) and structurally encoded
- **AND** a URL returned by `ctx.uploadAsset` (the host's own output) SHALL be structurally encoded but NOT scheme-restricted (the host owns its return scheme, e.g. a custom `nexus-vault://`)

#### Scenario: Alt/title text cannot break Markdown syntax

- **WHEN** the HTML contains an `<img>` or `<a>` whose `alt`/`title` (or link text) contains Markdown-significant characters or a crafted breakout (e.g. `<img alt="x](javascript:alert(1))![" src="https://e/a.png">`, `<img title='x") [c](javascript:alert(1)) ("' src="https://e/a.png">`, or `<a href="https://ok">x](javascript:alert(1))[y</a>`)
- **THEN** the converted output SHALL NOT produce any additional link/image or any `javascript:`-scheme destination from the alt/title/link text
- **AND** image `alt`/`title` and link `title` SHALL be Markdown-escaped (or stripped) before they are emitted (link text relies on the converter's text-node escaping, with the converter major pinned)

### Requirement: Never break paste on error

The plugin SHALL fall through (never throw, never hang) when sanitization or conversion fails or the input is oversized, and SHALL never lose convertible text from an already-consumed paste.

#### Scenario: Converter or oversized input falls through

- **WHEN** sanitization/conversion throws during the synchronous decision phase, or the pasted HTML exceeds the size cap
- **THEN** the plugin SHALL return false (not throw) and the default plain-text paste SHALL occur

#### Scenario: Image upload failure after consume still inserts text

- **WHEN** the plugin has consumed the paste and an image upload (or its decode) throws or rejects
- **THEN** the plugin SHALL still insert the converted Markdown with the failed image(s) omitted (it SHALL NOT throw); a paste containing any text SHALL always insert that text (an all-images-failed paste with no text may insert nothing)
