# Change: Convert rich HTML clipboard paste into Markdown

## Why

Pasting from a browser, Google Docs, Word, or another rendered page currently
falls through to CodeMirror's `text/plain` path. Headings, lists, links, and
emphasis collapse into unstructured text, which is the opposite of what a
Markdown-native editor should do. Image/file paste already has a host hook
(`onAssetUpload`); HTML paste has no equivalent.

## What Changes

- **ADDED** a pure `htmlToMarkdown()` converter in `@floatboat/nexus-core`
  (DOMParser, no new runtime dependency).
- **ADDED** `EditorConfig.htmlPaste` (default **`true`**). When the clipboard
  carries `text/html` that converts to structured Markdown, the editor inserts
  that Markdown in one transaction. `htmlPaste: false` restores today's
  `text/plain` behaviour.
- Paste precedence is unchanged except for the new branch:
  1. plugin `paste` handlers
  2. clipboard files / images → `onAssetUpload`
  3. HTML → Markdown (this change)
  4. CodeMirror default
- Conversion is skipped when any selection range sits inside a fenced,
  indented, or inline code node, so source inside code blocks stays literal.
- `javascript:` / other unsafe URLs in pasted links and images are dropped
  rather than written into the document.
- React / Vue bindings pass the flag through in lockstep.

## Impact

- Affected specs: `editor-core`
- Affected code:
  - `packages/core/src/html-to-markdown.ts` (NEW)
  - `packages/core/src/lezer-helpers.ts` (code-context predicate)
  - `packages/core/src/editor.ts` / `types.ts` / `index.ts`
  - `packages/core/test/html-to-markdown.test.ts` (NEW)
  - `packages/core/test/editor.test.ts`
  - `packages/react/src/editor.tsx`
  - `packages/vue/src/editor.ts`
  - `packages/core/README.md`, `docs/ROADMAP.md` (+ zh)
- New dependencies: none.
- **No breaking changes.** Plain-text paste, file paste, and plugin handlers
  keep their current behaviour. Hosts that want the old HTML→plain fallback
  set `htmlPaste: false`.
