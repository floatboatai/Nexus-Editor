# @floatboat/nexus-plugin-paste

HTML-to-Markdown paste conversion for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor) — turns
rich-text clipboard content into clean Markdown on paste.

- **HTML → Markdown on paste** — when the clipboard carries `text/html`
  (copying from a browser, Office doc, Google Docs, another editor),
  the plugin converts it to Markdown before it lands in the document.
- **Pure-text passthrough** — when there is no `text/html`, the plugin
  steps aside and lets CodeMirror's native plain-text paste run.
- **File paste untouched** — image / attachment paste is left to core's
  `onAssetUpload` pipeline; this plugin never competes with it.
- **GFM-aware** — tables, task lists, and strikethrough from
  `turndown-plugin-gfm`.
- **Pure-function entry point** — `convertHtmlToMarkdown(html, options)`
  works with or without an editor instance, in Node, in a build script,
  in a Cloudflare Worker.
- **Headless** — no UI, no theme, no opinions about where the editor
  lives. Just logic.

## Install

```bash
pnpm add @floatboat/nexus-plugin-paste @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createPastePlugin } from "@floatboat/nexus-plugin-paste";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello\n\nStart typing...",
  plugins: [createPastePlugin()],
});
```

That's it. Copy a formatted snippet from a web page and paste — bold,
italics, headings, links, lists, and tables arrive as Markdown, not as
a wall of `<span>` tags.

## How it works

The plugin registers the `handlers.paste` hook that
`@floatboat/nexus-core` already reserves for exactly this purpose (see
`EditorEventHandlers` in `core/src/types.ts`). On each paste event:

1. If the clipboard holds **files** (images, attachments), the plugin
   returns `false` — core's `onAssetUpload` pipeline owns that path.
2. If there is **no `text/html`** flavor, the plugin returns `false` —
   CodeMirror's native plain-text paste runs unmodified.
3. Otherwise the `text/html` payload is run through
   `convertHtmlToMarkdown` and inserted via `ctx.insertMarkdown`, and
   the event is consumed (`return true`).

The conversion layer is a standalone pure function, so it is fully
testable without an editor and reusable outside the plugin.

## Options

```ts
createPastePlugin({
  // Convert <table> to GFM tables. Default: true.
  tables: true,
  // Keep unmappable inline HTML (<span style="...">) instead of
  // stripping it. Default: false (strip — emit pure Markdown).
  keepInlineHtml: false,
  // Max heading level (1–6). Deeper headings become bold paragraphs.
  // Default: 6.
  headingMaxLevel: 6,
  // Custom gate: return false to skip conversion for this paste and
  // let core handle it. Default: convert whenever text/html is present.
  shouldConvert: (event) => true,
  // Override / append turndown rules.
  rules: [],
});
```

## Standalone usage

The converter does not need an editor:

```ts
import { convertHtmlToMarkdown } from "@floatboat/nexus-plugin-paste";

const md = convertHtmlToMarkdown("<h1>Title</h1><p>Body <b>bold</b></p>");
// "# Title\n\nBody **bold**"
```

## License

MIT © floatboat
