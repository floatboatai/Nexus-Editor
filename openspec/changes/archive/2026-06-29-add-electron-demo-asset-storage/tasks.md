## 1. Core: harden the file-upload emitter

- [x] 1.1 In `packages/core/src/editor.ts` `insertUploadedAssets` (~466-484), before composing the snippet (cover **both** `![label](url)` image and `[label](url)` non-image forms): Markdown-escape/strip `[` `]` `(` `)` and reject control chars in `label` (the untrusted `file.name`); **structurally encode** (`(` `)` `[` `]` `<` `>` space) the `url` but do **NOT** scheme-gate it — the url is `config.onAssetUpload`'s host-controlled return (e.g. `nexus-vault://`), identical trust to the plugin's `ctx.uploadAsset` return. Additive; benefits every host.

## 2. Binary write IPC (main)

- [x] 2.1 Add a `vault:write-asset` IPC handler in `apps/electron-demo/electron/main.ts` taking `(mimeType: string, bytes: Uint8Array)`: validate `mimeType` against a raster allowlist (`image/png`/`jpeg`/`gif`/`webp`; reject otherwise → return `null`); enforce a byte-size cap (reject oversized → `null`); **generate** a safe name `<timestamp>-<crypto-random>.<ext>` (ext from the validated MIME — never from any renderer string); resolve `<vault>/attachments/<name>` and assert it stays inside the vault via the existing `assertInsideVault` lexical guard (`~main.ts:127-138`); `mkdir -p` the dir; write the bytes (optionally `O_EXCL`). Return the generated name (or `null`).

## 3. Bridge wiring (preload + types)

- [x] 3.1 Expose `vault.writeAsset(mimeType, bytes)` in `electron/preload.ts` (alongside the text `vault.write`, `~line 55`).
- [x] 3.2 Add `writeAsset(mimeType: string, bytes: Uint8Array): Promise<string | null>` to `VaultBridge` in `src/renderer/bridge.d.ts`.

## 4. Renderer onAssetUpload

- [x] 4.1 Add `onAssetUpload` to `createEditor({…})` in `src/renderer/editor-shell.ts:~128`: if no active/writable vault → return `null`; else early-reject a non-raster `File.type` (→ `null`), read the `File` bytes (`arrayBuffer()` → `Uint8Array`), call `vault.writeAsset(file.type, bytes)`, and on a returned name return `nexus-vault://vault/attachments/<name>` (absolute, so `resolveImageSrc` passes the scheme through and the protocol handler resolves it against the vault root — renders in any subdir); `null` from IPC → return `null`.

## 5. Verification

- [x] 5.1 `openspec validate add-electron-demo-asset-storage --strict` passes.
- [x] 5.2 `pnpm typecheck` passes.
- [x] 5.3 `pnpm test` passes (incl. core tests: a `File` named `a](javascript:alert(1))[t](javascript:alert(1)).png` → `insertUploadedAssets` output has no extra link and no `javascript:` destination; **and** an `onAssetUpload` returning `nexus-vault://vault/attachments/x.png` → that URL survives in the output, not dropped).
- [x] 5.4 `pnpm build:electron-demo` passes.
- [ ] 5.5 Manual smoke: with a vault open, paste/drop an image into a **root** note and a **subdirectory** note (`notes/foo.md`) → both save under `<vault>/attachments/` and render; a `File` named `../../escape.png` stays confined under `attachments/`; a non-image (or SVG) → not written, image dropped; oversized → not written; no vault open → no write, image dropped.
- [ ] 5.6 With `add-html-paste-markdown`'s plugin temporarily registered, paste a `data:` image → it is saved locally via this `onAssetUpload` and rendered (the end-to-end save-to-local default; confirms the plugin keeps the `nexus-vault://` return rather than dropping it).
