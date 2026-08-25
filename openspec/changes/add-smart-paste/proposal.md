# Change: Add Markdown-aware smart paste and copy

## Why

The editor's clipboard experience has three gaps that users of every modern Markdown editor (Obsidian, Typora, GitHub comments) take for granted: pasting a table copied from Excel or a web page inserts raw HTML tags instead of a GFM pipe table; pasting a URL over selected text inserts a bare URL instead of `[text](url)`; and copying editor content does not advertise a `text/markdown` clipboard flavor, so Markdown-aware receivers cannot recognize the source. `#197` proposes a generic turndown-based converter as a separate plugin (two new runtime dependencies); this change covers the highest-frequency behaviors as a core capability with zero new dependencies.

## What Changes

- **ADDED** `EditorConfig.smartPaste?: boolean | SmartPasteOptions` — opt-in (default `false`, mirroring `multiCursor`) clipboard enhancement with three independently toggleable behaviors:
  - `tables` (default `true` when enabled): paste HTML containing `<table>` as a GFM pipe table (alignment from `text-align`/`align`, `\|` escaping, `<br>` flattening, inline bold/italic/code/link serialization)
  - `linkify` (default `true` when enabled): paste a single URL over a non-empty, single-line, non-link selection as `[selection](url)`; replacing the target when the selection itself is a URL
  - `markdownCopy` (default `true` when enabled): attach a `text/markdown` flavor alongside the browser defaults on copy/cut
- **ADDED** `packages/core/src/smart-paste/` — pure-function converters (`htmlTableToGfm`, `applyUrlLinkify`) plus the CM6 `domEventHandlers` extension; no editor-instance coupling in the converters
- All smart-paste insertions dispatch as **one CM6 transaction** (one undo entry)

## Impact

- Affected specs: `smart-paste` (new capability)
- Affected code: `packages/core/src/types.ts` (config type), `packages/core/src/editor.ts` (handler wiring), new `packages/core/src/smart-paste/` module, `packages/core/README.md`, `apps/electron-demo/src/renderer/editor-shell.ts` (enable for the demo), `docs/ROADMAP.md` + `docs/ROADMAP.zh.md` (row registration)
- Plugin `handlers.paste` hooks and the `onAssetUpload` file pipeline keep precedence; smart paste only runs when neither consumes the event
- **No breaking changes** to existing API
- **No new runtime dependencies**
