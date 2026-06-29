## Why

Pasting rich text / HTML from a browser, Word, or Google Docs and getting clean Markdown is a baseline feature of traditional Markdown editors (Typora, Obsidian, StackEdit). Nexus has **no** HTML→Markdown paste today — the only clipboard handling is image-file paste (`collectFilesFromDataTransfer` → `onAssetUpload`). Pasting formatted content drops to plain text. This change adds a paste plugin that converts pasted HTML into Markdown, sanitizes untrusted HTML at the trust boundary, and keeps the converted link/image destinations and alt/title text syntactically safe.

## What Changes

- Add a new package `@floatboat/nexus-plugin-paste` registering `NexusPlugin.handlers.paste`.
- On paste, when the clipboard has **meaningful** HTML (a formatting/structural element is present) and **no files**:
  1. **Sanitize** with DOMPurify (explicit element/attribute allowlist + default URI handling), inert.
  2. **Tokenize** every `<img src>` and `<a href>` in the DOM (so raw URLs never reach the converter), then **convert** HTML→Markdown with `turndown` + `turndown-plugin-gfm` (pinned config and pinned major).
  3. **Resolve image tokens**: remote `http(s)` images → `![alt](url)`; `data:` images → MIME-validated (`image/*` only), decoded to a `File` with a safe generated name and routed through `ctx.uploadAsset`; **all uploads are awaited, then the Markdown is inserted once** (no in-document placeholders); unsupported/failed → dropped. The host's `onAssetUpload` decides where bytes go (v1 default = save-to-local).
  4. **Scheme-validate + structurally encode** every HTML-derived link/image destination (allowlist http/https/mailto/path-relative, reject protocol-relative `//host`), **structurally encode** the host's `ctx.uploadAsset` return (no scheme restriction — the host owns its return scheme), and **Markdown-escape** image alt/title and link title, so neither a destination nor surrounding text can break Markdown syntax.
  5. Insert via `ctx.insertMarkdown(...)` and consume.
- **Fall through** (return false) for plain-text-only, no-formatting HTML, and **any clipboard containing files** — so the editor's default paste and core's `onAssetUpload` (today's image paste) still run. On sanitize/convert error → fall through; on a post-consume upload failure → insert best-effort Markdown (never throw, never empty).
- **Small core change**: export `collectFilesFromDataTransfer` so the plugin's file-detection matches core exactly (incl. `clipboardData.items`).
- The electron-demo's **real local sink** (a binary `onAssetUpload`) is a **sibling change** `add-electron-demo-asset-storage` — this change depends on it only for the manual smoke; all automated tests mock `ctx.uploadAsset`.
- Docs, roadmap rows, and root `pnpm build` wiring for the new package.
- Additive, opt-in; no breaking API changes. Text/links/remote-images convert synchronously; `data:` images upload via `ctx.uploadAsset` with all uploads awaited before a single insertion.

## Capabilities

### New Capabilities

- `html-paste`: convert pasted rich-text/HTML into Markdown with sanitization and syntactically-safe destinations and text, falling through for plain-text and file pastes.

### Modified Capabilities

- None at the spec level (one additive core util export).

## Impact

- Affected packages: a new `@floatboat/nexus-plugin-paste`; a tiny additive `@floatboat/nexus-core` change (export `collectFilesFromDataTransfer`). The electron-demo's real save-to-local sink is the sibling change `add-electron-demo-asset-storage` (also fixes the demo's currently-absent/broken image-file upload).
- Dependency impact: **three new runtime dependencies** — `turndown` (MIT), `turndown-plugin-gfm` (MIT), `dompurify` (MPL-2.0 OR Apache-2.0) — all GOVERNANCE §6.3-compatible; per-dependency justification in the plugin README; pin `turndown` + `dompurify` majors.
- Public API impact: additive (new plugin + one core util export).
- Behavior impact: opt-in. Without the plugin, paste is unchanged; **image-file paste is unchanged** (always falls through to `onAssetUpload`).
- Security: pasted HTML is untrusted → DOMPurify allowlist **and** structural encoding/scheme-validation of converted destinations (reject `//host`) + Markdown-escaping of alt/title text (the primary control for the markdown-link vector). A *pre-existing* core link-sink XSS — authored markdown URLs honored verbatim at **≥4 DOM sinks across 3 files** (`live-preview.ts` `window.open`, `live-preview-renderers.ts` `window.open` + `element.href`, `live-preview-table.ts` `a.href`) plus `exportHTML` — is **tracked separately, not fixed here**; the plugin is therefore the sole control for the paste vector and escapes every destination and alt/title field itself. The plugin synthesizes a safe `File` name for decoded `data:` images so it can never originate a path-traversal payload; host-write confinement **and** hardening core's `insertUploadedAssets` (the file-upload emitter the sibling activates) are the sibling change's responsibility.
- Roadmap: an HTML-paste row, the `add-electron-demo-asset-storage` sibling, plus a **deferred "configurable image-save strategy"** row along two axes — `data:` destination (inline / upload-{local,cloud,custom} / drop) and remote handling (keep-URL / fetch+store), with unsaved buffers staged in tmp and relocated on save. v1 implements the **save-to-local default** by routing `data:` images through `ctx.uploadAsset`.
