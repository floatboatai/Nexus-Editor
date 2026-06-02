import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { GFM } from "@lezer/markdown";

import { footnoteExtension } from "./lezer-footnote-extension";

/**
 * The CodeMirror 6 LanguageSupport that powers our live-preview decoration
 * pipeline. Drives `syntaxTree(state)` — incremental, viewport-aware, and
 * runs synchronously in the editor's update cycle (no Worker round-trip).
 *
 * Extensions wired in:
 *   * GFM (Table + TaskList + Strikethrough + Autolink) from @lezer/markdown.
 *   * footnoteExtension — our custom MarkdownConfig adding [^id] reference
 *     and [^id]: definition node types so the live preview can recognise
 *     footnotes the same way remark-gfm does.
 *
 * `addKeymap: false` because the project owns its own markdown keymap in
 * `markdown-keymap.ts`; lang-markdown's defaults would conflict with the
 * existing Enter/Backspace bindings.
 *
 * `pasteURLAsLink: false` — the paste-to-link behaviour is opinionated and
 * the editor already has an asset-upload paste handler; let that win.
 */
export function createMarkdownLanguageSupport(): Extension {
  return markdown({
    extensions: [...GFM, footnoteExtension],
    addKeymap: false,
    pasteURLAsLink: false,
  });
}
