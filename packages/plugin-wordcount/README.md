# @floatboat/nexus-plugin-wordcount

Markdown-aware word, character, CJK, and reading-time statistics for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

- **Markdown-aware** — walks the mdast tree the editor already parsed,
  excluding code blocks, math, HTML, YAML frontmatter, and link /
  footnote definitions by default.
- **CJK-first** — Chinese / Japanese / Korean characters are counted
  per character by default (the Notion / Obsidian / Bear convention),
  with an opt-out for the legacy "run as one word" model.
- **Zero double-parsing** — when used as an editor plugin the AST is
  reused from `editor.getAst()`; a lazy unified pipeline is only
  instantiated for standalone `countMarkdown(source)` calls.
- **Status-bar widget bundled** — ARIA-live, framework-agnostic, fully
  i18n-able.
- **Pure-function entry point** — `countMarkdown(source, options)`
  works in Node, in a build script, in a Cloudflare Worker, with or
  without an editor instance.

## Install

```bash
pnpm add @floatboat/nexus-plugin-wordcount @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  createWordCountPlugin,
  attachWordCountPlugin
} from "@floatboat/nexus-plugin-wordcount";

const wordcount = createWordCountPlugin({ statusBar: {} });
const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello\n\nStart typing...",
  plugins: [wordcount]
});
attachWordCountPlugin(wordcount, editor);

// Query the latest stats at any time:
wordcount.subscribe(({ doc, selection, isSelectionActive }) => {
  console.log(doc.words, doc.readingTimeSeconds);
  if (isSelectionActive) console.log("selected:", selection.words);
});
```

The plugin returns an object that is both a valid `NexusPlugin` (pass
it to `createEditor`) and a query handle (read stats, subscribe, tear
down). `attachWordCountPlugin` binds the plugin to the editor — call
it once after `createEditor` returns.

## Why not just use `editor.getDocumentStats()`?

`@floatboat/nexus-core` ships a naive `doc.trim().split(/\s+/)`
counter on `EditorAPI.getDocumentStats()`. That's fine for a "rough
order-of-magnitude" display, but on a real Markdown document it:

- counts `**`, `#`, `` ` ``, and `<!-- ... -->` as words;
- counts `1` for a 1,000-character Chinese paragraph because the
  script has no inter-word spaces;
- counts code-block contents as prose;
- has no concept of reading time or selection-scoped stats.

This plugin is the "correct" version layered on top — both APIs
coexist; the naive one stays available for hosts that don't want a
mdast walk on every keystroke.

## Standalone use

```ts
import { countMarkdown } from "@floatboat/nexus-plugin-wordcount";

const stats = countMarkdown(`---
title: Demo
---

# Hello

Some **bold** prose, and \`code\` and $x^2$.

\`\`\`js
const x = 1; // not counted
\`\`\`

Done.`);

console.log(stats);
// {
//   words: 6,
//   latinWords: 6,
//   cjkCharacters: 0,
//   characters: 26,
//   charactersNoSpaces: 22,
//   lines: 12,
//   paragraphs: 2,
//   sentences: 2,
//   readingTimeSeconds: 2
// }
```

The first standalone call instantiates a unified pipeline
(`remark-parse` + `remark-gfm` + `remark-math` + `remark-frontmatter`)
and memoises it. Inside the editor plugin the AST is supplied
directly so this pipeline is never invoked at runtime.

## API

### `countMarkdown(source, options?): WordCountStats`

Pure function. Never throws — on parse failure it falls back to a
whitespace-only counter so the returned object is always populated.

| Option | Default | Notes |
|---|---|---|
| `ast` | `undefined` | Pre-parsed mdast `Root`. Pass to skip the lazy parser. |
| `exclude` | `["code", "inlineCode", "math", "inlineMath", "html", "yaml", "toml", "definition", "footnoteDefinition"]` | Node types whose text content does NOT contribute. Replaces (does not merge) the default. |
| `cjkUnit` | `"char"` | `"char"` counts each CJK ideograph as 1 word; `"word"` collapses consecutive same-script runs into 1 word. |
| `readingSpeed.wpm` | `238` | Latin words per minute (Brysbaert 2019 silent-reading average). |
| `readingSpeed.cpm` | `500` | CJK characters per minute. |
| `parser` | `undefined` | Bring-your-own `ParserLike`. Rarely needed. |

### `createWordCountPlugin(options?): WordCountPlugin`

Returns a `NexusPlugin` augmented with a query handle:

```ts
interface WordCountAPI {
  getStats(): WordCountStats;
  getSelectionStats(): WordCountStats;
  isSelectionActive(): boolean;
  subscribe(listener): Unsubscribe;
  destroy(): void;
}
```

Options:

| Option | Default | Notes |
|---|---|---|
| `debounceMs` | `150` | Throttle for full-document recomputes. Selection counts always run synchronously. |
| `cjkUnit` | `"char"` | Forwarded to `countMarkdown`. |
| `exclude` | (defaults) | Forwarded to `countMarkdown`. |
| `readingSpeed` | (defaults) | Forwarded to `countMarkdown`. |
| `statusBar` | `false` | Pass `{}` to mount the bundled status-bar widget with defaults; pass `StatusBarOptions` to customise. |
| `labels` | English | Baseline label overrides (also forwarded to the status bar). |

### `createStatusBar(plugin, options?): StatusBarHandle`

Mounts a vanilla-DOM bar that subscribes to the plugin and renders
word count, character count, reading time, and an optional selection
summary. The bar is `role="status"` + `aria-live="polite"` so screen
readers get the same affordance as sighted users.

```ts
const bar = createStatusBar(wordcount, {
  container: document.getElementById("footer")!,
  locale: "en-US",
  showCharactersNoSpaces: true,
  labels: { words: "words", characters: "chars" }
});

// later
bar.destroy();
```

## Internationalisation

Every visible string is overridable:

```ts
createWordCountPlugin({
  statusBar: {
    locale: "zh-CN",
    labels: {
      words: "字",
      characters: "字符",
      charactersNoSpaces: "字符 (不含空格)",
      readingTime: "分钟阅读",
      readingTimeShort: "< 1 分钟",
      selection: "已选择"
    }
  }
});
```

## Heuristics & limits

- **Sentences** are counted by matching `[.!?。！？]+` runs. False
  positives on abbreviations ("e.g.", "Dr.") — accepted in v1; a
  pluggable `sentenceSegmenter` is on the roadmap.
- **Image alt text** is included by default — Markdown authors
  typically write alt text *as prose*. Override with
  `exclude: [...defaults, "image"]`.
- **HTML blocks** in CommonMark consume everything until the next
  blank line, including prose on the same line. This plugin honours
  that semantics. Put a blank line between an HTML comment and your
  prose if you want the prose counted.

## License

MIT
