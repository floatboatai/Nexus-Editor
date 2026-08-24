# Smart Paste Spec

## ADDED Requirements

### Requirement: opt-in clipboard enhancement configuration

`createEditor` SHALL accept a `smartPaste` config that is either `false` (the default), `true` (all behaviors enabled), or an object with independently toggleable `tables`, `linkify`, and `markdownCopy` options (each defaulting to `true` when the object form is provided). When `smartPaste` is `false` or absent, the editor SHALL NOT register any smart-paste or smart-copy DOM event handlers, and paste/copy behavior SHALL be byte-for-byte identical to previous releases.

#### Scenario: disabled by default
- **WHEN** `createEditor({ container })` is called without `smartPaste`
- **THEN** pasting HTML table markup or URLs over a selection SHALL produce the same document content as before this change

#### Scenario: object form toggles one behavior
- **WHEN** `createEditor({ container, smartPaste: { linkify: false } })` is called and a URL is pasted over selected text
- **THEN** the URL SHALL be inserted verbatim (no link wrapping)

### Requirement: HTML table paste converts to a GFM pipe table

When `smartPaste` tables behavior is enabled and the paste payload's `text/html` flavor contains a `<table>` element, the editor SHALL insert an equivalent GFM pipe table in place of the default HTML/text paste. Cell `text-align` / `align` attributes SHALL map to the delimiter-row alignment markers (`---`, `:---`, `---:`, `:---:`); literal `|` characters inside cell content SHALL be escaped as `\|`; `<br>` SHALL flatten to a space; `<strong>`/`<b>`, `<em>`/`<i>`, `<code>`, and `<a href>` SHALL serialize to their Markdown inline equivalents. Ragged rows (fewer or more cells than the header) SHALL be tolerated by padding with empty cells or dropping extras. HTML without a `<table>` element, or a table with zero rows, SHALL NOT be converted — the default paste path SHALL run unchanged.

#### Scenario: simple two-column table
- **WHEN** `<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>` is pasted
- **THEN** the inserted text SHALL be `| a | b |\n| --- | --- |\n| 1 | 2 |`

#### Scenario: alignment is preserved
- **WHEN** a header cell carries `style="text-align: right"` and another `align="center"`
- **THEN** the delimiter row SHALL be `| ---: | :---: |`

#### Scenario: pipe character inside a cell
- **WHEN** a cell's text is `a|b`
- **THEN** the serialized cell SHALL be `a\|b` and the table SHALL still parse as the original column count

#### Scenario: non-table HTML is not intercepted
- **WHEN** `<p>hello</p>` is pasted
- **THEN** the default paste behavior SHALL run (no GFM table inserted)

### Requirement: URL paste linkifies the selection

When `smartPaste` linkify behavior is enabled and the paste payload is a plain-text single URL (`http://` or `https://` scheme), the editor SHALL transform the insertion according to the selection: a non-empty, single-line selection that is not itself inside an existing Markdown link SHALL become `[selection](url)`; when the selected text is itself a URL, it SHALL become the link label under the new URL (`[old-url-text](new-url)`). A collapsed selection SHALL insert the URL verbatim; a multi-line selection or a selection already containing link syntax SHALL fall through to the default paste behavior. URL text containing spaces or unbalanced parentheses SHALL be wrapped in `<...>` angle-bracket form.

#### Scenario: paste URL over plain selection
- **WHEN** `nexus` is selected and `https://example.com` is pasted
- **THEN** the document SHALL contain `[nexus](https://example.com)`

#### Scenario: paste URL over a URL selection
- **WHEN** `https://old.example.com` is selected and `https://new.example.com` is pasted
- **THEN** the document SHALL contain `[https://old.example.com](https://new.example.com)`

#### Scenario: collapsed selection is untouched
- **WHEN** the cursor is collapsed and `https://example.com` is pasted
- **THEN** the URL SHALL be inserted verbatim

#### Scenario: multi-line selection falls through
- **WHEN** a selection spans multiple lines and a URL is pasted
- **THEN** the default paste behavior SHALL run (no link wrapping)

### Requirement: smart paste inserts atomically

Every smart-paste insertion SHALL be dispatched as a single CodeMirror transaction, producing exactly one undo entry. A single `undo()` SHALL revert the whole pasted table or link and restore the pre-paste selection content.

#### Scenario: one undo reverts a pasted table
- **WHEN** an HTML table is pasted and `undo()` is invoked once
- **THEN** the document SHALL equal its pre-paste content exactly

### Requirement: copy and cut advertise a Markdown flavor

When `smartPaste` markdownCopy behavior is enabled, `copy` and `cut` events on the editor content SHALL additionally write the selected source Markdown to `event.clipboardData` under the `text/markdown` MIME type, while leaving the browser's default `text/plain` and `text/html` flavors intact. A collapsed selection SHALL NOT modify the clipboard payload.

#### Scenario: copy carries the Markdown flavor
- **WHEN** a range of Markdown source is selected and the user copies
- **THEN** `clipboardData.getData("text/markdown")` SHALL return the selected source, and `getData("text/plain")` SHALL remain the browser default

#### Scenario: collapsed copy is untouched
- **WHEN** the selection is collapsed and the user copies
- **THEN** no `text/markdown` entry SHALL be added
