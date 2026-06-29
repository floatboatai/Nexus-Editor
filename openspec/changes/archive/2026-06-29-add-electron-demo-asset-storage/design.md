## Context

`apps/electron-demo` is an Electron app embedding `@floatboat/nexus-core`'s `createEditor`. Verified baseline:

- `createEditor({…})` in `src/renderer/editor-shell.ts:~128` sets **no** `onAssetUpload`, so `editor.ts:660-680`'s image-file fallback (`collectFilesFromDataTransfer` → `config.onAssetUpload` → `insertUploadedAssets`) gets `null` and does nothing.
- `insertUploadedAssets` (`editor.ts:466-484`) composes `` `![${file.name}](${url})` `` with the label (`file.name`) and `url` **unescaped** — inert today (no `onAssetUpload`), but this change activates it.
- The renderer↔main bridge writes **UTF-8 text only**: every `vault:write`/create handler uses `writeFile(abs, content, "utf-8")` and accepts `string` (`electron/main.ts:~101/313/353`; `electron/preload.ts:~55`; `src/renderer/bridge.d.ts`). There is **no binary write path**.
- `main.ts:~127-138` has an `assertInsideVault`-style guard that uses `path.resolve` + `path.relative` (**lexical**, not `fs.realpath`) — reuse it.
- The demo resolves image URLs via `resolveImageSrc` (`editor-shell.ts:~39-66`, called `~170`): a URL with a scheme passes through unchanged (`:~44`); a relative URL is joined onto the **active file's directory** and mapped into the vault. The `nexus-vault` protocol handler (`main.ts:~420-432`) resolves `nexus-vault://vault/<rel>` against the **vault root** (drops the `vault` host, re-applies `path.relative` + `..`/absolute rejection).
- `onAssetUpload` is `(file: File) => Promise<string|null>` (`packages/core/src/types.ts:120`) — it receives only the `File` (no editor context), so the demo reads `state.activeFile`/`state.vaultPath` from closure.

## Goals / Non-Goals

**Goals:** a working demo `onAssetUpload` that persists image bytes to the vault, path-confined, returning a URL that renders for a note in any directory; harden the core file-upload emitter the change activates; fix the demo's pre-existing broken image-file paste; provide the real local sink the `add-html-paste-markdown` smoke depends on.

**Non-Goals:** the configurable image-save strategy (the deferred two-axis item: `data:` destination × remote handling; note-sibling layout; tmp→relocate on save) — roadmap. De-duplication of identical bytes and asset GC are out of scope. Fixing the separate ≥4-sink click-time link XSS is out of scope (this change only does the producer-side `insertUploadedAssets` escaping it activates). No change to `@floatboat/*` public APIs.

## Decisions

### Decision: a dedicated binary IPC channel carrying the MIME (main owns name generation)

Add `vault:write-asset(mimeType: string, bytes: Uint8Array)` rather than widening the text `vault:write`. The **main** process is the single trust boundary: it validates `mimeType` against the raster allowlist, **generates** the on-disk name, and confines the path. The renderer passes only the validated MIME + bytes — it never supplies a filename. This resolves the earlier ambiguity (renderer-vs-main name ownership) by putting both name-generation and confinement in main; the renderer's own `File.type` check is an early-reject optimization / defense-in-depth, not the authoritative gate.

### Decision: host generates the name — never trust `File.name` or `File.type`-for-path

`File.name` is attacker-influenceable (the OS/`DataTransfer` source on a drop; a plugin-synthesized name on the `data:` path). The handler derives the stored name as `<timestamp>-<crypto-random>.<ext>`, where `<ext>` comes from a **whitelist keyed by `mimeType`** (`image/png`→`png`, `image/jpeg`→`jpg`, `image/gif`→`gif`, `image/webp`→`webp`; reject everything else, incl. `image/svg+xml`). The random component uses `crypto.randomUUID()`/`crypto.randomBytes` (not `Math.random`) so concurrent uploads don't collide; optionally open with `O_EXCL` so a collision errors rather than overwriting. No incoming name is ever used for the path or extension.

### Decision: defense-in-depth path confinement (lexical, matching the existing guard)

Even with a generated name, resolve the final absolute path and assert it stays under `<vault>/attachments/` via the existing `assertInsideVault` (`main.ts:~127-138`) — a `path.resolve` + `path.relative` **lexical** prefix check (consistent with the demo's other writers and the protocol handler). `mkdir -p` the attachments dir. Symlink-based escape (a pre-planted symlinked `attachments/`) is **out of the demo's threat model** and not covered by the lexical check; a host needing it would swap in `fs.realpath`. Reject (return `null`) on any failure. Enforce a byte-size cap (reject oversized → `null`) to guard local disk-fill.

### Decision: harden core `insertUploadedAssets` (the emitter this change activates)

Because setting `onAssetUpload` turns on `insertUploadedAssets` (`editor.ts:466-484`), and the image-file path bypasses any paste plugin's escaping, harden the emitter itself (additive, benefits all hosts): Markdown-escape/strip `[` `]` `(` `)` and reject control chars in the `label` (derived from the untrusted `file.name`), and **structurally encode** (`(` `)` `[` `]` `<` `>` space) the `url` — but do **NOT** scheme-gate the url. The url is `config.onAssetUpload`'s return, the host's own trusted output (identical trust to the plugin's `ctx.uploadAsset` return, e.g. `nexus-vault://`); scheme-gating it would wrongly drop the demo's own custom-scheme URL (the B-II trust placement, here applied to the *other* consumer of the same return). Apply to **both** emitted forms — `![label](url)` (image) and `[label](url)` (non-image file). The bytes are trusted by their MIME label (no magic-byte sniff in v1); this is safe today because assets are only ever referenced as `![](…)` and the `nexus-vault` protocol handler serves them with an extension-derived `image/*` content-type (never `text/html`/`svg`) — a magic-byte check is a defense-in-depth add-when-served-otherwise item. This is the same producer-side discipline the paste plugin applies to its own output (`label` = attacker-influenced → escape; `url` = host output → encode-only), here applied to core's file-upload output.

### Decision: return an absolute `nexus-vault://` URL

Return `nexus-vault://vault/attachments/<name>`. `resolveImageSrc` passes a scheme-bearing URL through unchanged, and the protocol handler resolves it against the vault root — so the image renders for a note in **any** subdirectory with **no** resolver change. (A relative path would have to be computed against the active file's directory to render in subdirs; the absolute scheme URL avoids that fragility, at the cost of being demo-specific rather than portable Markdown — acceptable for the demo. The `add-html-paste-markdown` plugin therefore must NOT scheme-restrict the `uploadAsset` return — that contract is reconciled there.)

### Decision: no active vault → `null`

If there is no open vault (or no writable path), return `null`; the core/plugin then drops the image (no leftover artifact). The demo already gates other vault ops on an open vault.

## Risks / Trade-offs

- **Absolute `nexus-vault://` URLs are not portable** outside the demo — fine for a demo sink; portable note-relative layout is the roadmap strategy item.
- **No de-dup / GC** — repeated pastes accumulate files in `attachments/` (size-capped per file); acceptable for a demo (noted).
- **Lexical (non-realpath) confinement** — symlink escape uncovered; out of the demo threat model given host-generated names.
- **Extension whitelist may reject exotic image types** — intentional (SVG-as-stored-content risk); the set is easily extended.

## Migration Plan

1. Core: harden `insertUploadedAssets` (escape label; structurally encode url only — no scheme check/gate; both `![label](url)` and `[label](url)` forms).
2. `main.ts`: add `vault:write-asset(mimeType, bytes)` handler (validate MIME, generate name, size-cap, `assertInsideVault`, `mkdir -p attachments`, write, return name).
3. `preload.ts`: expose `vault.writeAsset(mimeType, bytes)`.
4. `bridge.d.ts`: add the method to `VaultBridge`.
5. `editor-shell.ts`: add `onAssetUpload` (no vault → null; reject non-raster `File.type`; read bytes; call IPC; return `nexus-vault://…`).
6. Verify: paste/drop saves + renders for a root note and a subdir note; a `File.name` of `../../escape.png` and a `File.name` with `](javascript:…)[` are both neutralized; non-image/SVG → `null`; oversized → `null`; no vault → `null`.

Rollback: remove the handler/preload/type/`onAssetUpload` and the core escaping — demo returns to its current (no-op) image paste. (The core escaping is harmless to keep.)

## Open Questions

- Whether to also offer a note-relative path mode and `fs.realpath` confinement — deferred to the configurable-strategy roadmap item / a host-hardening change.
