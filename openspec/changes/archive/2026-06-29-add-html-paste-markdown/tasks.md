## 1. Core: export file-detection helper

- [x] 1.1 Add `export` to `collectFilesFromDataTransfer` in `packages/core/src/editor.ts`, then re-export it from `packages/core/src/index.ts` (additive) so the plugin reuses the exact detection (incl. `clipboardData.items` kind==="file").

## 2. Plugin scaffold + dependencies

- [x] 2.1 Scaffold `@floatboat/nexus-plugin-paste` exporting `createPastePlugin()` registering `NexusPlugin.handlers.paste`. The handler returns its consume boolean **synchronously** (it is NOT a top-level `async` function — `runEventHandlers` does not await and treats a returned Promise as truthy → would consume every paste); the upload+single-insert runs in a detached async task after the sync `true`.
- [x] 2.2 Add `turndown`, `turndown-plugin-gfm`, `dompurify` with a per-package GOVERNANCE §6.3 justification; **pin the `turndown` and `dompurify` majors** (link/text-escaping / `DATA_URI_TAGS` defaults are load-bearing).
- [x] 2.3 Wire the new package into the root `pnpm build` script (it hardcodes per-package filters).

## 3. Convertibility + fall-through

- [x] 3.1 Consume only when the sanitized HTML contains a formatting/structural element (enumerate the set: `a`, `strong`/`em`/`b`/`i`, `h1`–`h6`, `ul`/`ol`/`li`, `table`+children, `code`/`pre`, `blockquote`, `del`/`s`, `img`); fall through for plain-text and no-formatting HTML.
- [x] 3.2 Fall through whenever the clipboard contains files (via the exported `collectFilesFromDataTransfer`), so core `onAssetUpload` runs.
- [x] 3.3 Wrap the whole synchronous decision phase (meaningfulness + sanitize + tokenize + convert) in try/catch → return `false` on error; cap pasted-HTML byte size **before any parse/regex** → fall through above the cap (ReDoS/pathological input). Once consumed (a `data:` upload is in flight), wrap the detached async task in its own try/catch → insert best-effort Markdown (failed images omitted), never throw; a paste with any text always inserts that text (an all-images-failed, text-less paste may insert nothing).

## 4. Sanitize + syntactically-safe output

- [x] 4.1 DOMPurify with an explicit element/attribute allowlist that EXCLUDES `svg`, `image`, `video`, `audio`, `source`, `track`, `foreignObject`, `math`, `object`, `embed`, `iframe`, `base`, `form`, `style`, `script`; use DOMPurify's **default** `ALLOWED_URI_REGEXP` and default `DATA_URI_TAGS` (`data:` on `<img>` only); inert parse (no live `innerHTML`/fetch); `keep` empty. (Note: the default regexp admits `//host`; the plugin's own resolver in 4.3 rejects it.)
- [x] 4.2 Tokenize every `<img src>` **and** every `<a href>` in the DOM with a unique inert token **before** turndown — turndown then emits `![alt](TOKEN)` / `[text](TOKEN)`. After conversion, resolve each **destination placeholder** (the TOKEN inside the emitted construct) in the Markdown string: remote `http(s)`/path-relative → the validated+encoded URL (per 4.3); `data:` image → validate MIME is a supported raster type (`image/png`/`jpeg`/`gif`/`webp`; reject `data:text/html`, `image/svg+xml`, …) → decode to a `File` with a **safe generated basename** (no separators/`..`/NUL; extension from the validated MIME). Process each `data:` image inside a **per-image async wrapper** (decode → `ctx.uploadAsset(file)`, whole wrapper `.catch(() => null)`) and await with `Promise.allSettled` (a decode throw or upload rejection drops only that image), then replace each TOKEN with the returned URL (structurally encoded; null/failed/disallowed → remove the whole `![…](TOKEN)`), then `insertMarkdown` **once**. No in-document placeholders, no `replaceRange`/`getDocument`.
- [x] 4.3 For every **HTML-derived** emitted link/image destination: scheme-allowlist (`http`/`https`/`mailto`/path-relative) — **reject protocol-relative authorities** (`//host` and backslash `/\host`; classify via URL parsing, not `startsWith("//")`) — **and** structurally encode `(` `)` `[` `]` `<` `>` space (reject control chars); never post-hoc string-replace a raw `src`/`href`. For the **`ctx.uploadAsset` return URL** (host's own output): apply only the structural encoder, NOT the scheme allowlist (the host owns its return scheme, e.g. `nexus-vault://`). Markdown-escape (or strip) `[` `]` `(` `)` `"` and reject control chars in image `alt`, image `title`, and link `title` before they are emitted (link text relies on the pinned converter's text-node escaping).
- [x] 4.4 Pin turndown config: `headingStyle:"atx"`, `codeBlockStyle:"fenced"`, `bulletListMarker:"-"`, `strongDelimiter:"**"`, `emDelimiter:"_"`, `linkStyle:"inlined"`; add `turndown-plugin-gfm`.

## 5. Tests (jsdom + DOMPurify init)

- [x] 5.1 Configure the test environment: jsdom + initialize DOMPurify with the jsdom `window` so the security tests actually execute.
- [x] 5.2 HTML bold/italic/links/headings/nested lists/inline code → expected Markdown; a hyperlink whose text==plain → `[text](url)`.
- [x] 5.3 GFM table/strikethrough/task list → GFM; `<h1>`→`# `, code block→fenced.
- [x] 5.4 Plain-text and no-formatting HTML fall through unchanged.
- [x] 5.5 Any clipboard with files (incl. `items` kind==="file") is not consumed → `onAssetUpload` runs.
- [x] 5.6 Remote `<img>` → `![](url)`; `data:image/png` `<img>` → uploaded via `ctx.uploadAsset` (mocked) → returned URL in output (not inlined), all uploads awaited then a single insert; **two** `data:` images where one upload rejects **or one decode throws (bad base64)** → the other image + the text still inserted, only the failed one omitted (per-image best-effort); null upload → image omitted; non-raster `data:` (e.g. `data:text/html`, `data:image/svg+xml`) → not uploaded, omitted; a mock returning a custom-scheme URL (`nexus-vault://…`) → kept (not dropped).
- [x] 5.7 **Security**: `<script>`/`<iframe>`/`onclick`/`<img onerror>`/`<svg><image xlink:href="data:…">`/`javascript:`/`data:`(link)/`vbscript:`/entity-encoded handler are stripped and inert; `<img src="/x)[t](javascript:alert(1))">`, `<a href="https://x)[c](javascript:alert(1))">t</a>`, the alt/title breakouts `<img alt="x](javascript:alert(1))![" src="https://e/a.png">` and `<img title='x") [c](javascript:alert(1))' src="https://e/a.png">`, a link-text breakout `<a href="https://ok">x](javascript:alert(1))[y</a>`, a protocol-relative `<a href="//evil.com">x</a>`, and a backslash-authority `<a href="/\evil.com">x</a>` each produce **no** extra link/image, **no** `javascript:` scheme, and **no** `//host`/`/\host` destination (parse the emitted Markdown and assert no disallowed destination in any node, with concrete expected escaped output for the alt/title cases).
- [x] 5.8 Converter throw / oversized input → plugin returns false (fall through).

## 6. Documentation and roadmap

- [x] 6.1 Plugin `README.md` (documented lossy set; note `data:` images upload via `ctx.uploadAsset` so the host stores them — save-to-local default, configurable strategy deferred — remote images kept as links, image-file paste handled by core; **limitation**: a clipboard with both rich text and an image file falls through to the file upload, so the rich text is not converted in v1) + list the plugin in the top-level `README.md` / `README.zh.md`.
- [x] 6.2 Add Roadmap rows in `docs/ROADMAP.md` + `docs/ROADMAP.zh.md`: (a) **HTML/rich-text paste → Markdown** (this change; v1 routes `data:` images via `ctx.uploadAsset` = save-to-local default); (b) **`add-electron-demo-asset-storage`** — the demo's real binary `onAssetUpload` + hardening the core `insertUploadedAssets` emitter (also fixes pre-existing image-file paste); (c) **DEFERRED — configurable image-save strategy** along **two axes**: `data:` destination (inline / upload-{local,cloud,custom} / drop) and remote handling (keep-URL / fetch+store); unsaved buffers staged in tmp and relocated on first save (host `onAssetUpload`).

## 7. Verification

- [x] 7.1 `openspec validate add-html-paste-markdown --strict` passes.
- [x] 7.2 Focused tests pass: `pnpm exec vitest run` for the new plugin.
- [x] 7.3 `pnpm typecheck` passes.
- [x] 7.4 `pnpm test` passes.
- [x] 7.5 `pnpm build` passes (and actually builds `@floatboat/nexus-plugin-paste`).
- [x] 7.6 `pnpm build:electron-demo` passes.
- [ ] 7.7 Manual smoke: temporarily register `createPastePlugin()` in electron-demo **with a temporary inline mock `onAssetUpload` that returns a `nexus-vault://…` URL** (the same scheme the real sibling sink returns, so the return-URL handling is actually exercised); paste a formatted snippet (link + remote image + a `data:` image) → Markdown with the link, `![](remote-url)`, and `![](mock-returned-url)`; paste plain text → unchanged; paste an image **file** → still uploads; then remove the temporary wiring. (Real local-disk end-to-end is verified by the sibling change `add-electron-demo-asset-storage`.)
