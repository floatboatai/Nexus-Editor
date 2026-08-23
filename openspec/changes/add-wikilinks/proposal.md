# Change: Add Obsidian-Style Bidirectional Wiki Links

## Why

Note-taking users expect Obsidian-style `[[target]]` bidirectional links: type a double-bracket link, have it render as a clickable chip that navigates to the target file, and see a backlinks panel listing every note that links back to the current one. The existing editor + vault support single-file browsing and ordinary markdown `[text](url)` links, but has no concept of "the set of notes that refer to this note", which is the core value proposition of a personal knowledge base.

## What Changes

- **Core package** gains a new `wikilinks` extension:
  - Recognizes `[[target]]`, `[[target|alias]]` inline syntax via doc-scan (no parser dependency needed).
  - Renders wiki links as cursor-aware mark decorations: `[[` / `]]` hidden unless the cursor is strictly inside the wikilink span (element-granular reveal).
  - Accepts a `resolve(name, fromPath)` callback; resolved links get accent styling + pointer cursor, unresolved links get muted red/dashed styling.
  - Accepts an `onNavigate(target)` callback invoked on click.
  - Accepts a `suggest(query)` async callback to drive CM6 autocomplete after `[[`.
  - Exported both as a standalone `createWikilinksExtension(options)` and as a `createWikilinksPlugin(options)` NexusPlugin.
- **Electron demo** gains a vault-scoped link graph:
  - New IPC `vault:read-all` returns every markdown file's contents for one-shot index seeding.
  - New renderer module `link-index.ts` maintains forward + backward link maps and incremental updates on file watch / edit.
  - New renderer component `backlinks-panel.ts` shows the reverse index for the active file with one-line context snippets.
  - New toolbar button toggles the backlinks panel.
  - Wiki-link clicks call `handleVaultFileOpen`; clicks on **unresolved** links prompt to create the target file in the same directory as the active file.
  - Autocomplete candidates are drawn from the link index (all known vault notes).
- **No breaking changes.** Editors constructed without the plugin behave exactly as today; the core extension is opt-in.

## Impact

- Affected specs:
  - `live-preview` (MODIFIED — add wiki-link inline rendering requirement)
  - `note-vault` (ADDED — link index, backlinks panel, wiki-link navigation)
- Affected code:
  - `packages/core/src/wikilinks.ts` (new)
  - `packages/core/src/index.ts` (export)
  - `packages/core/test/wikilinks.test.ts` (new)
  - `apps/electron-demo/electron/main.ts` (new IPC handler)
  - `apps/electron-demo/electron/preload.ts` (bridge)
  - `apps/electron-demo/src/renderer/bridge.d.ts` (types)
  - `apps/electron-demo/src/renderer/link-index.ts` (new)
  - `apps/electron-demo/src/renderer/backlinks-panel.ts` (new)
  - `apps/electron-demo/src/renderer/editor-shell.ts` (plug into editor)
  - `apps/electron-demo/src/renderer/app.ts` (layout + toggle + wiring)
  - `apps/electron-demo/src/renderer/state.ts` (link-index holder)
  - `apps/electron-demo/src/renderer/style.css` (backlinks styles)
- New dev dependency: none. Reuses existing `@codemirror/autocomplete`.
- Out of scope for this change (explicit non-goals):
  - `[[target#heading]]` anchor and `[[target^blockid]]` block references (v2).
  - Rename-propagating link updates across the vault (v2).
  - Graph view (v2).
  - Frontmatter-driven aliases (v2).
