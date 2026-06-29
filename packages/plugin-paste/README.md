# @floatboat/nexus-plugin-paste

Convert pasted rich-text / HTML into Markdown, sanitizing the untrusted HTML at
the trust boundary and keeping every converted link/image destination — and the
alt/title text around it — syntactically safe.

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createPastePlugin } from "@floatboat/nexus-plugin-paste";

createEditor({
  container,
  plugins: [createPastePlugin()],
  onAssetUpload: async (file) => saveSomewhere(file), // host stores data: images
});
```

## What it does

On paste, when the clipboard has **meaningful** HTML (a formatting/structural
element is present) and **no files**, the plugin:

1. **Sanitizes** with DOMPurify (explicit element/attribute allowlist, default
   URI handling, inert parse).
2. **Tokenizes** every `<img src>` / `<a href>` and every `alt`/`title` field,
   then **converts** to Markdown with `turndown` + `turndown-plugin-gfm` using
   the editor's conventions (ATX headings, fenced code, `-` bullets, `**`
   strong, `_` em).
3. **Resolves** destinations: remote `http(s)`/path-relative → `![alt](url)` /
   `[text](url)`; `data:` images → MIME-validated raster only, decoded to a
   `File` with a safe generated name and routed through `ctx.uploadAsset`
   (**save-to-local default** — the host stores the bytes); all uploads are
   awaited, then the Markdown is inserted **once**.
4. **Validates + encodes** every destination and **escapes** alt/title text so
   nothing can break Markdown syntax or carry a disallowed URL scheme.

## Falls through (does not consume) for

- Plain-text-only clipboards and HTML with no formatting (plain text wrapped in
  `<p>`/`<div>`/`<span>`).
- **Any clipboard containing files** — image-file paste stays with core's
  `onAssetUpload`, unchanged.
- Sanitize/convert errors or oversized input.

## Limitations

- **A clipboard with both rich text and an image file falls through** to the
  file-upload path, so the rich text is **not** converted in v1.
- **`data:` images** are uploaded via `ctx.uploadAsset` (save-to-local
  default); **remote images are kept as links** (no fetch/store). The
  configurable image-save strategy is deferred (see the roadmap).
- **Lossy conversion**: unknown/unsupported elements are flattened to text —
  `<mark>`, `<sub>`/`<sup>`, `<u>`, and spanning (`colspan`/`rowspan`) table
  cells lose their semantics. Strikethrough is emitted single-tilde
  (`~text~`).

## Security

Pasted HTML is untrusted. The plugin is the sole control for the paste vector:
it sanitizes with a DOMPurify allowlist (excluding `svg`/`image`/`video`/
`audio`/`object`/`embed`/`iframe`/`base`/`form`/`style`/`script` …), and then
independently scheme-allowlists (`http`/`https`/`mailto`/path-relative) and
rejects protocol-relative `//host` / backslash `/\host` authorities (via URL
parsing) on every HTML-derived destination, structurally percent-encodes
destinations, and Markdown-escapes alt/title text. A URL returned by
`ctx.uploadAsset` is the host's own output, so it is structurally encoded but
**not** scheme-restricted (keeps custom schemes like `nexus-vault://`). The
synthesized `File` name for a decoded `data:` image is always a safe basename
with the extension derived from the validated MIME, so the plugin can never
originate a path-traversal payload.

## Dependencies (GOVERNANCE §6.3)

| Package | Version | License | Why | Cost of writing it ourselves |
|---|---|---|---|---|
| `turndown` | `^7.2.4` (major pinned) | MIT | HTML→Markdown conversion engine | Re-implementing a robust HTML-tree-to-Markdown converter with the editor's conventions |
| `turndown-plugin-gfm` | `^1.0.2` | MIT | GFM tables / strikethrough / task lists for turndown | Hand-writing GFM emit rules |
| `dompurify` | `^3.4.11` (major pinned) | MPL-2.0 OR Apache-2.0 (Apache-2.0 used; §6.3-compatible) | Sanitize untrusted pasted HTML at the trust boundary | Maintaining a sanitizer against an evolving XSS surface — not feasible to do safely by hand |

`turndown` and `dompurify` majors are pinned because their escaping
(`escapeLinkDestination`/`escapeMarkdown`) and `DATA_URI_TAGS`/
`ALLOWED_URI_REGEXP` defaults are load-bearing for correctness and security.
