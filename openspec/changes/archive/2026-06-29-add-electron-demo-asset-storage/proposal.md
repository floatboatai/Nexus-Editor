## Why

`apps/electron-demo` sets **no** `onAssetUpload`, so image-file paste/drop (`collectFilesFromDataTransfer` → `config.onAssetUpload` → `insertUploadedAssets`, `editor.ts:466-484`) silently does nothing today — a pre-existing broken feature. It also blocks the `add-html-paste-markdown` plugin's `data:`-image save-to-local path from being demonstrated end-to-end (the plugin calls `ctx.uploadAsset`, which is null in the demo). Core is headless and cannot write files, so a real local sink must live in the host. The demo's renderer↔main bridge writes **UTF-8 text only** — there is no binary write path — so this is a small but multi-layer host change, not a one-liner. Enabling `onAssetUpload` also **activates** core's `insertUploadedAssets`, which today composes `` `![${file.name}](${url})` `` with the label and url **unescaped** — so this change must also harden that core emitter (otherwise a crafted `File.name` injects a markdown link → the unguarded link sinks → XSS).

## What Changes

- Add a binary `vault:write-asset` IPC handler in `apps/electron-demo/electron/main.ts` that accepts `(mimeType: string, bytes: Uint8Array)`, validates `mimeType` against a raster allowlist (`image/png`/`jpeg`/`gif`/`webp`; reject everything else incl. `image/svg+xml`), **generates** a safe unique name `<timestamp>-<crypto-random>.<ext>` (ext from the validated MIME — **never** from any renderer-supplied name), **confines** the path to the vault (the existing `assertInsideVault` resolve+relative prefix guard, `main.ts:~127-138`), enforces a byte-size cap, `mkdir -p`s `<vault>/attachments/`, writes the bytes, and returns the generated name (or `null` on reject/no-vault).
- Expose it via `electron/preload.ts` (alongside the existing text `vault.write`, `~line 55`) and add `writeAsset(mimeType: string, bytes: Uint8Array): Promise<string | null>` to the renderer bridge type (`src/renderer/bridge.d.ts`, `VaultBridge`).
- Add an `onAssetUpload` to the demo's `createEditor({…})` (`src/renderer/editor-shell.ts:~128`) that: returns `null` if no active/writable vault; else early-rejects a non-raster `File.type` (→ `null`), reads the `File` bytes (`arrayBuffer()` → `Uint8Array`), calls `vault.writeAsset(file.type, bytes)`, and returns an absolute `nexus-vault://vault/attachments/<name>` URL.
- **Harden core `insertUploadedAssets`** (`packages/core/src/editor.ts:466-484`, additive): Markdown-escape/strip `[` `]` `(` `)` + reject control chars in the `label` (the untrusted `file.name`), and **structurally encode (not scheme-gate) the `url`** — it is `onAssetUpload`'s host-controlled return (e.g. `nexus-vault://`) — for **both** `![label](url)` and `[label](url)` forms, so enabling `onAssetUpload` does not turn on an injection path while still rendering the host's own custom-scheme URL. Benefits every host, not just the demo.
- Returning the absolute `nexus-vault://` URL means the existing `resolveImageSrc` (`editor-shell.ts:~39-66`) passes the scheme through unchanged (`:~44`) and the `nexus-vault` protocol handler (`main.ts:~420-432`) resolves it against the vault root — so the image renders for a note in **any** subdirectory with **zero** resolver changes.

## Capabilities

### New Capabilities

- `demo-asset-storage`: the electron-demo persists pasted/dropped image assets to the vault via a path-confined binary IPC and returns a vault-resolvable URL; core's file-upload emitter is hardened against label/url injection.

### Modified Capabilities

- None at the spec level beyond the additive `demo-asset-storage` capability (the core `insertUploadedAssets` hardening is an additive escaping fix, no API change).

## Impact

- Affected packages: `apps/electron-demo` (main + preload + renderer bridge type + editor-shell) and a small additive `@floatboat/nexus-core` hardening (`insertUploadedAssets` label/url escaping).
- Public API impact: none (no library API change; `onAssetUpload` is existing `EditorConfig`).
- Behavior impact: image-file paste/drop in the demo starts saving to `<vault>/attachments/` and rendering (today it silently no-ops); enables the `add-html-paste-markdown` `data:`-image end-to-end smoke.
- Security: untrusted `File.name`/`File.type` is never used for the on-disk path or extension; the **main** process generates the name and `assertInsideVault`-confines the final path — closing the path-traversal/arbitrary-write vector. Non-raster types (incl. SVG) are rejected (a stored SVG could later be served as active content). A byte-size cap guards local disk-fill. The core `insertUploadedAssets` escaping closes the label/url markdown-injection that enabling `onAssetUpload` would otherwise activate. (The separate ≥4-sink click-time hardening remains tracked elsewhere; this producer-side escaping is sufficient to keep the file-upload path from emitting an injectable destination.)
- Dependency impact: none (Node `fs`/`path`/`crypto` already available in the Electron main).
