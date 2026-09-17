## ADDED Requirements

### Requirement: convert rich HTML clipboard paste to Markdown

When `EditorConfig.htmlPaste` is not `false` (the default), a `paste` event whose clipboard contains `text/html` SHALL insert Markdown produced by `htmlToMarkdown()` instead of the browser's `text/plain` fallback, provided all of the following hold:

- no plugin `paste` handler consumed the event
- the clipboard has no files (file/image paste still uses `onAssetUpload`)
- no selection range sits inside a fenced code block, indented code block, or inline code span
- the converted Markdown is structurally richer than `text/plain` (headings, emphasis, links, images, lists, blockquotes, code fences, or tables)

`htmlPaste: false` SHALL restore the previous CodeMirror `text/plain` paste path.

#### Scenario: Heading paste becomes an ATX heading
- **WHEN** the clipboard HTML is `<h1>Title</h1>` and `text/plain` is `Title`
- **THEN** the editor SHALL insert `# Title`

#### Scenario: Plain paragraph does not rewrite paste
- **WHEN** the clipboard HTML is `<p>hello</p>` and `text/plain` is `hello`
- **THEN** the editor SHALL leave paste to CodeMirror (document remains unchanged by the HTML converter)

#### Scenario: File paste still uses the asset pipeline
- **WHEN** the clipboard contains an image file and `onAssetUpload` is configured
- **THEN** the HTML converter SHALL NOT run
- **AND** the existing upload-and-insert path SHALL still insert `![...](url)`

#### Scenario: Paste inside a fenced code block stays literal
- **WHEN** the cursor is inside a ` ``` ` fenced code block
- **AND** the clipboard contains `<h1>Title</h1>`
- **THEN** the editor SHALL NOT insert `# Title`

#### Scenario: htmlPaste false disables conversion
- **WHEN** `htmlPaste: false` is set
- **AND** the clipboard HTML is `<h1>Title</h1>`
- **THEN** the HTML converter SHALL NOT insert Markdown

### Requirement: provide a dependency-free HTML to Markdown converter

`htmlToMarkdown(html)` SHALL parse HTML with `DOMParser` and return Markdown covering headings, `strong`/`em`/`del`, links, images, ordered/unordered/task lists, blockquotes, inline and fenced code, thematic breaks, and GFM tables. `javascript:` and non-image `data:` URLs SHALL be omitted from the Markdown target. Hosts MAY call the function without creating an editor.

#### Scenario: Nested list keeps indentation
- **WHEN** HTML contains an unordered list whose item contains a nested unordered list
- **THEN** the nested item SHALL be indented with two extra spaces and keep a `- ` marker

#### Scenario: Unsafe link href is dropped
- **WHEN** HTML contains `<a href="javascript:alert(1)">click</a>`
- **THEN** the result SHALL contain `click` and SHALL NOT contain `javascript:`
