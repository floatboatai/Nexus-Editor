## 1. Core parser and match fields

- [x] 1.1 Add `parseWikiLinkTarget`, `stripWikiLinkAnchor`, `findAnchorPosition`, collectors
- [x] 1.2 Populate `path` / `anchor` on `WikiLinkMatch`; allow `[[#heading]]`
- [x] 1.3 Same-file anchors skip `resolve` and render as resolved

## 2. Autocomplete and navigation

- [x] 2.1 Export `getWikiLinkTypingContext` and `suggestAnchors`
- [x] 2.2 Pass `path` / `anchor` through `onNavigate`
- [x] 2.3 Unit tests for parse, scan, styling, typing context, heading completion
- [x] 2.4 Same-file `[[^id]]`, missing-anchor `findAnchorPosition` null, `[[^` autocomplete

## 3. Electron demo

- [x] 3.1 Reuse core parsers from `link-index.ts`
- [x] 3.2 `getFileContent` on the link index reader
- [x] 3.3 Wire `suggestWikilinkAnchors` from vault / current buffer
- [x] 3.4 Sample vault `anchor-demo.md` + README verification for `#` / `^` / nested / missing

## 4. Docs

- [x] 4.1 Document the public helpers on `packages/core/README.md`
