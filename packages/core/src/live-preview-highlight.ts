// Main-thread synchronous syntax highlighter for fenced code blocks. Mirrors
// the curated language set the parser-worker used to ship with — small
// enough that the V8 JIT can keep regex paths hot, fast enough that calling
// it inline from buildDecorations doesn't introduce visible jank for typical
// code-block sizes.
//
// Switching to this path is what lets the editor drop the worker round-trip
// for ASTs entirely: Lezer gives us code-block ranges synchronously
// (`syntaxTree(state)`) and hljs runs in-process to colour them.

import hljsCore from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import type { CodeHighlightToken } from "./types";

const hljs = hljsCore;
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerAliases("html", { languageName: "xml" });
hljs.registerAliases("sh", { languageName: "bash" });
hljs.registerAliases("zsh", { languageName: "bash" });
hljs.registerAliases("ts", { languageName: "typescript" });
hljs.registerAliases("js", { languageName: "javascript" });
hljs.registerAliases("py", { languageName: "python" });
hljs.registerAliases("yml", { languageName: "yaml" });

// Cap on per-block highlight cost. hljs is fast on short snippets; arbitrarily
// large code blocks (think a 500-line file pasted in) can still produce a
// blocking burst. Skip the highlight pass for any block past this size — the
// editor will render unstyled monospace text, which is correct, just unstyled.
const MAX_BLOCK_LEN = 50_000;

// Tiny LRU keyed by (lang, code). Cursor moves and unrelated edits trigger
// buildDecorations rebuilds; without this cache we'd re-highlight every
// visible fenced block on every keystroke.
const cache = new Map<string, CodeHighlightToken[]>();
const CACHE_LIMIT = 200;

function cacheGet(key: string): CodeHighlightToken[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  // Touch: remove + re-insert to bump LRU position.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: CodeHighlightToken[]): void {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Highlight a single fenced code block. `contentStart` is the document offset
 * where the code body begins (one past the opening fence's newline). Returns
 * an array of token spans whose offsets are absolute document positions, so
 * buildCodeBlockDecorations can apply them as Decoration.mark without any
 * coordinate translation.
 */
export function highlightCodeBlock(
  lang: string | null | undefined,
  code: string,
  contentStart: number,
): CodeHighlightToken[] {
  if (!code) return [];
  if (!lang) return [];
  if (code.length > MAX_BLOCK_LEN) return [];
  if (!hljs.getLanguage(lang)) return [];

  const key = `${lang}\u0000${code}`;
  const cached = cacheGet(key);
  if (cached) {
    if (contentStart === 0) return cached;
    // Cached tokens are stored at contentStart=0; rebase on read.
    return cached.map((t) => ({
      from: t.from + contentStart,
      to: t.to + contentStart,
      className: t.className,
    }));
  }

  let result: { _emitter: unknown };
  try {
    result = hljs.highlight(code, { language: lang }) as unknown as { _emitter: unknown };
  } catch {
    return [];
  }

  const tokens: CodeHighlightToken[] = [];
  emit(result._emitter, 0, tokens);
  cacheSet(key, tokens);
  if (contentStart === 0) return tokens;
  return tokens.map((t) => ({
    from: t.from + contentStart,
    to: t.to + contentStart,
    className: t.className,
  }));
}

// hljs's internal token stream walker. `_emitter.rootNode` is a TokenTree
// whose leaves are strings (untagged spans) and whose branches carry a
// `kind` (e.g. "string" or "string.regexp"). We accumulate position offsets
// and emit one CodeHighlightToken per leaf string with non-empty scope.
function emit(emitter: unknown, offset: number, out: CodeHighlightToken[]): void {
  const root = emitter as { rootNode?: { children?: unknown[] } } | null;
  if (!root || !root.rootNode) return;
  walkNode(root.rootNode, offset, [], out);
}

function walkNode(node: unknown, pos: number, scope: string[], out: CodeHighlightToken[]): number {
  const n = node as { children?: unknown[] };
  if (!n.children) return pos;
  let cursor = pos;
  for (const c of n.children) {
    if (typeof c === "string") {
      if (c.length > 0 && scope.length > 0) {
        const className = scope.map((s) => `hljs-${s}`).join(" ");
        out.push({ from: cursor, to: cursor + c.length, className });
      }
      cursor += c.length;
      continue;
    }
    const child = c as { kind?: string; children?: unknown[] };
    if (child?.kind) {
      cursor = walkNode(child, cursor, [...scope, child.kind], out);
    } else if (child?.children) {
      cursor = walkNode(child, cursor, scope, out);
    }
  }
  return cursor;
}
