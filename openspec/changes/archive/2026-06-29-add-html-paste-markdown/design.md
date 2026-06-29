## Context

The core paste pipeline is plugin-ready (`packages/core/src/editor.ts:660-680`): the `paste` handler runs every plugin `handlers.paste` first (`runEventHandlers`, first **synchronously-truthy** return consumes → `preventDefault`), then falls back to image/asset upload (`collectFilesFromDataTransfer` → `config.onAssetUpload` → `insertUploadedAssets`, `editor.ts:466-484`), else CM6 default plain-text paste. `runEventHandlers` (`editor.ts:456`) has **no try/catch** and **does not await** handlers — so a handler must return a plain boolean, never a Promise (a returned Promise is always truthy → would consume every paste). `EditorEventContext` (`types.ts:404-410`) exposes `insertMarkdown(md)` (→ `replaceSelection`, no-ops if the editor is destroyed) and `uploadAsset(file)` (→ `config.onAssetUpload`, `(File)=>Promise<string|null>`, `types.ts:120`); `collectFilesFromDataTransfer` (`editor.ts:86-103`) reads `.files` + `.items` kind==="file" and is **not yet exported**. The await-all image design (below) needs only `insertMarkdown` + `uploadAsset` — no in-document position API.

Security baseline: markdown link/image URLs are honored with **no scheme check** at the core sinks — there are **≥4 DOM sinks across 3 files** (not one shared sink): `live-preview.ts:~1467` `window.open(url,…)`, `live-preview-renderers.ts:~71` `window.open(url,…)`, `live-preview-renderers.ts:~65` `element.href = url` (executes a `javascript:` URL on an **ordinary** click — the most direct), and `live-preview-table.ts:~191` `a.href = node.url` (table-cell link); plus `editor.ts:~726` `exportHTML`/`markdownToHtml` emits URLs verbatim. Additionally core's **own** file-upload emitter `insertUploadedAssets` (`editor.ts:466-484`) composes `` `![${file.name}](${url})` `` with the label and url **unescaped** — a sibling/host that sets `onAssetUpload` activates that path (the sibling change owns hardening it). All pre-existing; the click-sink hardening is tracked separately. turndown's **image** rule copies `src` and emits `alt`/`title` through `cleanAttribute` (collapses newlines only — does **not** escape `[]()"`); its **link** rule escapes link *text* (text-node `escape`, which escapes `[` and `]`) and incidentally paren-escapes `href`, but does **not** escape the link `title`. So both a raw destination and unescaped alt/title text can break Markdown syntax and inject a second link with an arbitrary scheme into the unguarded sinks. Therefore this plugin is the **sole** control for the paste vector — every emitted destination *and* every emitted alt/title field is the plugin's responsibility.

Dependency baseline: `turndown`/`dompurify` absent.

Host baseline: core is headless and **cannot write files** — local saving happens only in a host `onAssetUpload`. `apps/electron-demo` currently sets **no** `onAssetUpload` (verified — `editor-shell.ts`'s `createEditor({…})` omits it), and its renderer↔main bridge writes **UTF-8 text only** (no binary IPC). A real local sink (binary IPC + path confinement + URL resolution + the `insertUploadedAssets` hardening it activates) is therefore a separable host change — see Non-Goals.

## Goals / Non-Goals

**Goals:** convert pasted HTML→Markdown with GFM fidelity and the editor's conventions; sanitize untrusted HTML (DOMPurify allowlist) **and** guarantee converted destinations and alt/title text cannot break Markdown syntax (structural encoding + scheme allowlist + text escaping); correct fall-through; decide consume **synchronously** and never throw or lose an already-consumed paste; text/links/remote-images convert synchronously and `data:` images upload via `ctx.uploadAsset` with **all uploads awaited (per-image best-effort) before a single Markdown insertion** (save-to-local default).

**Non-Goals (v1):**
- **The electron-demo's real local sink** — a binary `onAssetUpload` (binary IPC + vault-path confinement + correct URL resolution) **plus** hardening the core `insertUploadedAssets` emitter it activates — is its own change, **`add-electron-demo-asset-storage`** (it also independently fixes the demo's pre-existing broken image-*file* paste). This change depends on it only for the manual end-to-end smoke; all automated tests mock `ctx.uploadAsset`.
- **Configurable image-save strategy** — deferred, framed along **two axes**: the `data:` destination (inline / upload-{local,cloud,custom} / drop) and remote-image handling (keep-URL / fetch+store); unsaved buffers staged in tmp and relocated on first save. **v1 ships two defaults presented as "save-to-local": `data:` → `ctx.uploadAsset` (host stores), remote → keep-URL.** Only the configurable selector is the roadmap item.
- "Paste as plain text" bypass; `drop` HTML; RTF.
- Fixing the **pre-existing core link-sink URL XSS** (separate hardening change).

## Decisions

### Decision: meaningfulness by formatting-element presence

Consume only when the sanitized HTML contains a formatting/structural element (`a`, `strong`/`em`/`b`/`i`, `h1`–`h6`, `ul`/`ol`/`li`, `table`+children, `code`/`pre`, `blockquote`, `del`/`s`, `img`). Do not use `textContent == text/plain` (drops hyperlinks). Fall through when no such element is present (plain text wrapped in `<html>`/`<meta>`/`<p>`/`<div>`/`<span>`).

### Decision: file-bearing clipboards always fall through

If the clipboard contains files (via the exported `collectFilesFromDataTransfer`, incl. `.items` kind==="file"), the plugin returns false so core's `onAssetUpload` handles them — preserving today's image-file paste with no regression. (v1 does not try to merge rich text + an image file; that is the roadmap asset feature.)

### Decision: sanitize with DOMPurify — explicit allowlist, default URI handling

Run DOMPurify with an **explicitly enumerated** element/attribute allowlist (the formatting set above) that **excludes** `svg`, `image`, `video`, `audio`, `source`, `track`, `foreignObject`, `math`, `object`, `embed`, `iframe`, `base`, `form`, `style`, `script`. Use DOMPurify's **default** `ALLOWED_URI_REGEXP` (robust; do not hand-roll a "relative" branch inside DOMPurify). Note DOMPurify's default regexp **does admit** protocol-relative `//host` — so the plugin's own destination resolver (next decision) is what rejects `//`. Rely on DOMPurify's default `DATA_URI_TAGS` (keeps `data:` on `<img>` only, NOT on `<a>`/SVG) so v1 can decode+upload `data:` images; **never add `data:` to the URI regexp** (that would re-admit `data:` on links). Parse inertly (no live `innerHTML`/resource fetch). Pin the DOMPurify **major** (these defaults shift across majors). `keep` empty (unknown tags strip to text). DOMPurify's default URI allowlist is broader than the editor wants (e.g. `tel:`/`sms:`); the plugin's **own** scheme allowlist at token resolution is the authoritative gate on HTML-derived destinations.

### Decision: keep emitted Markdown syntactically safe (the security control)

turndown copies `src`/`href` and emits `alt`/`title` without guaranteeing they can't break Markdown syntax. Therefore, **before turndown runs, tokenize every `<img src>` and every `<a href>`** in the DOM with a unique inert token (never post-hoc string-replace a raw URL). After conversion:
- **Resolve each HTML-derived destination token**: scheme-allowlist (`http`/`https`/`mailto`/relative — the plugin's own gate, narrower than DOMPurify's) **and reject protocol-relative authorities** (`//host` and backslash-authority `/\host` — classify via URL parsing, not a `startsWith("//")` check, since parsers normalize `\`→`/`; only path/query/fragment-relative counts as "relative"); **and** structurally encode `(` `)` `[` `]` `<` `>` and space, rejecting control chars. A disallowed scheme → drop the link/image. This makes "every HTML-derived destination is validated+encoded" true for both `<img>` and `<a>`.
- **Escape alt/title text**: Markdown-escape (or strip) `[` `]` `(` `)` `"` and reject control chars in image `alt`, image `title`, and link `title` before they are emitted — the fields turndown leaves unescaped. Rationale: with `]` escaped, alt cannot close its `![…]` bracket to open a sibling destination; `title` is `"`-delimited and `"` is escaped; newlines/control chars are rejected. `<`/`>`/backtick in alt are therefore harmless (at most inline-code cosmetic) and need not be escaped. (Link *text* is already escaped by turndown's text-node `escape`, which escapes `[`/`]`.)
- The **`ctx.uploadAsset` return URL is the host's own output** (e.g. `nexus-vault://…`), not pasted-attacker input — apply **only the structural encoder** to it (so a filename-derived path can't break `![]()`), **not** the scheme allowlist (the host owns its return scheme; scheme-gating it would wrongly drop a custom-scheme URL).
- Pin the turndown **major** (its link-rule paren/text escaping is one layer; the plugin's own encoder is the authoritative one).

### Decision: data: images upload via await-all (per-image best-effort), single insert

v1's only upload sink is a **local disk write (fast)**, so there is no need for in-document placeholders. The handler's **synchronous** phase decides consumption (meaningful HTML, no files, within size cap) and produces the converted Markdown with remote/relative destinations already resolved and each `data:` image as a token. The handler returns its consume boolean synchronously (it is **not** a top-level `async` function); when `data:` tokens exist, the upload+insert runs in a **detached async task** after the synchronous `true` return. That task: **decode each `data:` image** (validate the MIME is a raster image — `image/png`/`jpeg`/`gif`/`webp`; reject `image/svg+xml` and all non-image) to a `File` with a **safe generated basename** (no path separators/`..`/NUL; extension from the validated MIME — never from attacker text); process each `data:` image inside a **per-image async wrapper** (decode → `ctx.uploadAsset(file)`, the whole wrapper `.catch(() => null)`) and await them together with `Promise.allSettled` — so a **decode throw (bad base64)** or an upload rejection drops only that image, not the batch; **replace each destination placeholder** (the token inside the emitted `![alt](TOKEN)`) with the returned URL (structurally encoded; null/failed/disallowed → remove the whole `![…](TOKEN)`); then `insertMarkdown` **once**. This deletes the placeholder machinery (in-document tokens, `indexOf`-at-replace races, bounds-guarded `replaceRange`, remove-on-failure mutation, multi-undo). Tradeoff: when `data:` images are present, insertion is deferred until uploads finish and lands at the cursor's *then-current* position (sub-100ms for a local sink; `insertMarkdown` no-ops if the editor was destroyed meanwhile). Placeholders are only justified by a *slow* (cloud) sink — the roadmap strategy item.

### Decision: the electron-demo's real local sink is a sibling change

Local saving can only happen in a host `onAssetUpload`, the demo has none, and adding a working one is a multi-layer, security-sensitive sub-project (binary IPC + preload + bridge type + renderer wiring + path-traversal confinement + active-file-correct URL resolution + hardening the `insertUploadedAssets` emitter it activates) that *also* independently fixes the demo's pre-existing broken image-*file* paste. That belongs in its own change, **`add-electron-demo-asset-storage`**, not folded into a paste-feature diff. This change keeps the plugin-side contract (`data:`→`ctx.uploadAsset`, tested against a mock) plus a plugin-side defense-in-depth (safe synthesized `File` name, so the plugin can never originate a traversal payload); the host-write confinement + emitter hardening live in the sibling.

### Decision: pin turndown to the editor's conventions

`headingStyle:"atx"`, `codeBlockStyle:"fenced"`, `bulletListMarker:"-"`, `strongDelimiter:"**"`, `emDelimiter:"_"`, `linkStyle:"inlined"`; plus `turndown-plugin-gfm` (tables/strikethrough/task lists). Unknown tags strip to text; document the lossy set (`<mark>`, `<sub>`/`<sup>`, `<u>`, spanning tables).

### Decision: decide synchronously; never throw; never lose a consumed paste; cap input size

The whole synchronous decision phase (read clipboard → meaningfulness → sanitize → tokenize → convert) is wrapped in try/catch → on any throw return false (fall through), nothing consumed. The consume decision is returned **synchronously** as a boolean. Cap pasted-HTML byte size **before any parse/regex touches it**; above the cap, fall through (guards pathological/ReDoS input). Once the paste is consumed (a `data:` upload is in flight), the detached async task is wrapped in its own try/catch and inserts the **best-effort** Markdown (failed images omitted); it never throws. If the converted content was *only* images and all uploads failed, it may insert nothing — acceptable (better than inlining base64); a paste that has any text always inserts that text.

## Risks / Trade-offs

- **Sanitizer/encoding completeness** — delegated to DOMPurify (maintained) + the plugin's destination encoder + alt/title escaper; tested with breakout (`/x)[t](javascript:…)`, alt/title breakout, link-text breakout, `//evil`), `<svg><image data:>`, `<img onerror>`, `data:`/`vbscript:` link, entity-encoded handler.
- **Sole control, no defense-in-depth** — the core click sinks stay unguarded (deferred), so any encoder gap is live; mitigated by escaping *every* emitted destination and alt/title field, rejecting `//`, and pinning the converter major. The deferred hardening change should route all ≥4 sinks through **one shared `safeUrl()` helper** (there is no single existing shared sink today).
- **Three new deps** — `turndown`/`turndown-plugin-gfm` MIT, `dompurify` MPL-2.0-OR-Apache-2.0 (all §6.3-compatible); plugin-isolated, majors pinned; per-dep justification in the plugin README.
- **Converter fidelity** on messy Word/Docs HTML — bounded; lossy set documented; on throw, fall through.
- **DOM in tests** — DOMPurify + turndown need a DOM; tests run under jsdom and must initialize DOMPurify with the jsdom window.
- **Deferred insert with data: images** — await-all means the insert lands after uploads finish at the then-current cursor; sub-100ms for the local sink, acceptable for v1; the cloud (slow) case is the roadmap strategy item.

## Migration Plan

1. Core: export `collectFilesFromDataTransfer` (from `editor.ts`, then re-export from `index.ts`).
2. Scaffold the plugin; add `turndown` + `turndown-plugin-gfm` + `dompurify` (+ §6.3; pin majors).
3. Implement: meaningfulness, DOMPurify sanitize (explicit allowlist), img-src + a-href tokenization, destination encoding/scheme-validation (reject `//`) + alt/title escaping, `data:` decode (raster-MIME-validated, safe name) → per-image best-effort await-all upload → single insert, turndown (pinned), synchronous-consume + try/catch + size cap.
4. Wire the package into root `pnpm build`.
5. Tests (incl. security fixtures) + docs + roadmap rows.
6. Verify (validate --strict, typecheck/test/build/electron-demo, manual smoke against a temporary `nexus-vault://`-returning mock `onAssetUpload`; real local disk via the sibling change).

Rollback: additive + opt-in — remove the plugin and the additive core export.

## Open Questions

- **The electron-demo's real local sink** → the sibling change `add-electron-demo-asset-storage` (binary IPC + confinement + URL resolution + `insertUploadedAssets` hardening; also fixes the demo's pre-existing image-file paste).
- **Configurable image-save strategy** along two axes (`data:` destination × remote handling; tmp→relocate on save) — deferred to the roadmap; v1 ships the save-to-local default via `ctx.uploadAsset`.
- "Paste as plain text" command, `drop` HTML, RTF — deferred.
- Pre-existing core link-sink URL XSS (≥4 DOM sinks across 3 files) — separate hardening change, ideally via one shared `safeUrl()` helper.
