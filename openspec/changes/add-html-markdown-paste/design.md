## Context

Clipboard paste already has two dedicated paths: plugin `handlers.paste`, then
the `onAssetUpload` file/image pipeline. Anything else is native CodeMirror
`text/plain`. Rich HTML from browsers / office apps is therefore lost, even
though the product is a Markdown-source-of-truth editor.

Hosts cannot fix this well from outside: they would have to re-implement
clipboard inspection, code-block detection, and URL sanitization on every
framework binding.

## Goals / Non-Goals

- Goals:
  - Convert common rich-text HTML (headings, emphasis, links, images, lists,
    blockquotes, code, GFM tables, task items) into idiomatic Markdown.
  - Keep the converter dependency-free and unit-testable.
  - Leave plugin / file paste / in-code paste behaviour pixel-identical.
  - Refuse `javascript:` and similarly unsafe URLs so pasted HTML cannot plant
    executable links.
- Non-Goals:
  - A full HTML spec / CSS visual clone (Google Docs highlight colours, fonts).
  - Round-tripping Nexus live-preview widgets through `text/html`.
  - Importing Word/Docs comments, footnotes, or tracked changes.
  - Using Turndown or any other HTML→MD library.

## Decisions

- Decision: **DOMParser + hand-written serializer**, not Turndown.
  - Alternatives: Turndown (MIT, extra runtime dep, GOVERNANCE §6.3 bar),
    regex replace (breaks on nesting/tables).
  - Rationale: the tag set we care about is small; a focused walker is less
    surface area than a general-purpose library, and we can encode the
    sanitizer next to the serializer.
- Decision: **`htmlPaste` defaults to `true`**, with an explicit opt-out.
  - Alternatives: default-off (safer for unknown hosts, but then every demo
    and new consumer has to discover the flag).
  - Rationale: conversion only fires when `text/html` is present *and* the
    result is structurally richer than `text/plain`. Unstructured `<p>hello</p>`
    pastes still take the plain-text path, so existing "paste a sentence"
    behaviour is preserved.
- Decision: **skip conversion inside Lezer `FencedCode` / `CodeBlock` /
  `InlineCode`**, using `syntaxTree` ancestry.
  - Pasting into a code fence must remain literal; converting a copied
    `<pre>` into nested fences would corrupt the surrounding source.
- Decision: **unsafe URLs become link/image text without a target**, rather
  than being passed through or rejected as a whole paste.

## Risks / Trade-offs

- Office/Docs HTML is noisy (`<b style="font-weight:normal">` wrappers,
  `StartFragment` comments). → Unwrap spans; honour style-attribute
  `font-weight` / `font-style` / `text-decoration` so Docs emphasis survives;
  ignore unknown tags.
- Over-converting a copy that is already Markdown in `text/plain`. → If the
  converted string equals the plain text, fall through to CodeMirror.
- `Decoration.replace` live-preview copy may produce HTML of the *rendered*
  view rather than source. → Same richer-than-plain heuristic; when the user
  copied visible "bold" text the conversion recovers `**bold**`, which is
  the desired source.

## Migration Plan

Additive. Hosts that dislike the new path set `htmlPaste: false`. No data
migration, no API removals.
