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
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import objectivec from "highlight.js/lib/languages/objectivec";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import type { CodeHighlightToken } from "./types";

const hljs = hljsCore;
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("less", less);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("objectivec", objectivec);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("python", python);
hljs.registerLanguage("r", r);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerAliases("html", { languageName: "xml" });
hljs.registerAliases("htm", { languageName: "xml" });
hljs.registerAliases("vue", { languageName: "xml" });
hljs.registerAliases("sh", { languageName: "bash" });
hljs.registerAliases("zsh", { languageName: "bash" });
hljs.registerAliases("shell", { languageName: "bash" });
hljs.registerAliases("ts", { languageName: "typescript" });
hljs.registerAliases("tsx", { languageName: "typescript" });
hljs.registerAliases("js", { languageName: "javascript" });
hljs.registerAliases("jsx", { languageName: "javascript" });
hljs.registerAliases("mjs", { languageName: "javascript" });
hljs.registerAliases("cjs", { languageName: "javascript" });
hljs.registerAliases("py", { languageName: "python" });
hljs.registerAliases("yml", { languageName: "yaml" });
hljs.registerAliases("cs", { languageName: "csharp" });
hljs.registerAliases("c++", { languageName: "cpp" });
hljs.registerAliases("rb", { languageName: "ruby" });
hljs.registerAliases("rs", { languageName: "rust" });
hljs.registerAliases("kt", { languageName: "kotlin" });
hljs.registerAliases("md", { languageName: "markdown" });
hljs.registerAliases("text", { languageName: "plaintext" });
hljs.registerAliases("txt", { languageName: "plaintext" });
hljs.registerAliases("objc", { languageName: "objectivec" });
hljs.registerAliases("toml", { languageName: "ini" });
hljs.registerAliases("env", { languageName: "ini" });

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
    return cached.map((t) => ({ from: t.from + contentStart, to: t.to + contentStart, className: t.className }));
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
  return tokens.map((t) => ({ from: t.from + contentStart, to: t.to + contentStart, className: t.className }));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Highlight code to HTML (hljs class spans) for preview widgets.
 * Falls back to escaped plain text when language is unknown.
 */
export function highlightCodeToHtml(lang: string | null | undefined, code: string): string {
  if (!code) return "";
  if (code.length > MAX_BLOCK_LEN) return escapeHtml(code);
  const language = lang && hljs.getLanguage(lang) ? lang : null;
  if (!language) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/** Best-effort format for a few common languages. Returns null if unchanged / unsupported. */
export function formatCodeSource(lang: string | null | undefined, code: string): string | null {
  const normalizedLang = (lang || "").toLowerCase();
  if (normalizedLang === "json" || normalizedLang === "jsonc") {
    try {
      const parsed = JSON.parse(code);
      const pretty = JSON.stringify(parsed, null, 2);
      return pretty.endsWith("\n") ? pretty : `${pretty}\n`;
    } catch {
      return null;
    }
  }
  // Generic tidy: trim trailing whitespace per line, collapse trailing blank lines.
  const tidy = code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "\n");
  return tidy === code ? null : tidy;
}

// hljs v11 TokenTree: branches use `scope` (e.g. "keyword", "title.function").
// Older internals used `kind` — accept both. Compound scopes map to the same
// multi-class form as hljs HTML output: "title.function" → "hljs-title function_".
function scopeToCssClass(scopeName: string): string {
  if (!scopeName.includes(".")) return `hljs-${scopeName}`;
  const parts = scopeName.split(".");
  return [`hljs-${parts[0]}`, ...parts.slice(1).map((p) => `${p}_`)].join(" ");
}

function emit(emitter: unknown, offset: number, out: CodeHighlightToken[]): void {
  const root = emitter as { rootNode?: { children?: unknown[] } } | null;
  if (!root || !root.rootNode) return;
  walkNode(root.rootNode, offset, [], out);
}

function walkNode(
  node: unknown,
  pos: number,
  scope: string[],
  out: CodeHighlightToken[],
): number {
  const n = node as { children?: unknown[] };
  if (!n.children) return pos;
  for (const c of n.children) {
    if (typeof c === "string") {
      if (c.length > 0 && scope.length > 0) {
        const className = scope.map(scopeToCssClass).join(" ");
        out.push({ from: pos, to: pos + c.length, className });
      }
      pos += c.length;
      continue;
    }
    const child = c as { kind?: string; scope?: string; children?: unknown[] };
    // highlight.js v11 uses `scope`; some forks/older trees used `kind`.
    const scopeName = child?.scope ?? child?.kind;
    if (child && scopeName) {
      pos = walkNode(child, pos, [...scope, scopeName], out);
    } else if (child && child.children) {
      pos = walkNode(child, pos, scope, out);
    }
  }
  return pos;
}
