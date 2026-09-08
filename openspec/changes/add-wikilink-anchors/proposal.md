# Change: First-class wiki-link heading and block anchors

## Why

`[[target#heading]]`, `[[target^block-id]]`, and same-file `[[#heading]]` are the Obsidian wiki-link follow-up that the original `add-wikilinks` change listed as an explicit v2 non-goal. The Electron demo already re-parses those suffixes to jump after navigation, but core still treats the whole string as an opaque target: same-file jumps render as unresolved, autocomplete after `#` / `^` suggests note names, and every host has to copy the same parser.

## What Changes

- Core `scanWikiLinks` parses path vs heading/block anchor onto `WikiLinkMatch`.
- Same-file `[[#heading]]` / `[[^id]]` chips render as resolved (they do not ask `resolve()`).
- New host callback `suggestAnchors` completes headings and block ids after `[[note#` / `[[note^`.
- Pure helpers `parseWikiLinkTarget`, `findAnchorPosition`, `collectMarkdownHeadings`, and `collectMarkdownBlockIds` move into `@floatboat/nexus-core` so hosts share one implementation.
- Electron demo wires heading/block autocomplete from vault file contents.

No breaking changes: existing `[[target]]` / `[[target|alias]]` behaviour is unchanged; `onNavigate` gains additive `path` / `anchor` fields.

## Impact

- Affected specs: `wikilinks` (new capability)
- Affected code: `packages/core/src/wikilinks.ts`, `packages/core/src/index.ts`, `packages/core/test/wikilinks.test.ts`, `packages/core/README.md`, `apps/electron-demo/src/renderer/{link-index,editor-shell,app}.ts`
