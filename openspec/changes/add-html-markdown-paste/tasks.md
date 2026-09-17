## 1. Converter

- [x] 1.1 Add `htmlToMarkdown()` covering headings, emphasis, links, images, lists (incl. nested + task items), blockquotes, fenced/inline code, GFM tables, and `br`/`hr`
- [x] 1.2 Sanitize `javascript:` / `data:` (non-image) URLs on `a[href]` and `img[src]`
- [x] 1.3 Honour Docs/Word style-attribute bold/italic/strike; unwrap no-op `<b style="font-weight:normal">` wrappers
- [x] 1.4 Export `markdownFromClipboard(html, plain)` for the "richer than plain" paste heuristic

## 2. Editor integration

- [x] 2.1 Add `EditorConfig.htmlPaste?: boolean` (default true)
- [x] 2.2 Wire the paste handler after plugin hooks and file upload, before CM default
- [x] 2.3 Skip conversion when any selection range is inside a fenced / indented / inline code node
- [x] 2.4 Export the converter from `@floatboat/nexus-core`

## 3. Bindings and docs

- [x] 3.1 Pass `htmlPaste` through React `<Editor />` and Vue `<Editor />` in lockstep
- [x] 3.2 Document the flag and `htmlToMarkdown()` in `packages/core/README.md`
- [x] 3.3 Register the feature on `docs/ROADMAP.md` (+ zh)

## 4. Tests

- [x] 4.1 Unit tests for the converter (structure, nesting, sanitizer, Docs wrappers, tables, tasks)
- [x] 4.2 Editor paste tests: structured HTML inserts Markdown; plain text unchanged; files still upload; in-code paste stays literal; `htmlPaste: false` disables conversion
