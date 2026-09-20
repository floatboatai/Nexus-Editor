# Change: Add Local Markdown Image Embeds

## Why

The Electron demo already renders standard Markdown image nodes and already has a scoped `nexus-vault://` resource protocol, but local image references are not connected to the active Markdown file or Vault. Relative paths can resolve against the Vite renderer instead of the note directory, and Obsidian-style `![[image.png]]` embeds are treated as wiki-link text rather than image previews.

## What Changes

- Recognize Obsidian-style image embeds such as `![[image.png]]` in live preview while preserving the original Markdown source.
- Resolve standard Markdown image paths and Obsidian image embeds relative to the active Markdown file inside the current Vault.
- If the relative candidate is missing, resolve a unique matching image filename inside the current Vault.
- Keep external `http(s)` image URLs working unchanged.
- Load Vault-local images through the existing scoped `nexus-vault://` resource mechanism instead of exposing absolute filesystem paths or using `file://` URLs.
- Revoke image resource registrations when rendered image widgets are replaced, the active document changes, the Vault session changes, or the editor is destroyed.
- Add core, path-resolution, renderer, and Electron resource-lifecycle tests plus a sample-vault acceptance fixture.

## Scope

- V1 supports local images while editing a file inside an opened Vault.
- V1 supports standard Markdown images `![alt](path)` and Obsidian embeds `![[path]]`.
- V1 supports the existing image size syntax, including `![alt|width](path)` and `![[path|width]]`.
- Standalone single-file mode, clipboard upload, drag-and-drop import, remote caching, and image management UI remain out of scope.

## Impact

- Affected capabilities: `local-image-embeds`, `plugin-content-services`, and live-preview behavior in the Electron demo.
- Affected code: `packages/core/src/live-preview-ranges.ts`, `packages/core/src/wikilinks.ts`, `apps/electron-demo/electron/main.ts`, `apps/electron-demo/electron/preload.ts`, `apps/electron-demo/src/renderer/image-resolver.ts`, `apps/electron-demo/src/renderer/editor-shell.ts`, `apps/electron-demo/src/renderer/app.ts`, and related tests.
- No new runtime dependency.
- No breaking changes to existing editor APIs; applications without an image resolver keep the current URL behavior.
