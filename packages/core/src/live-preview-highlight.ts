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

// 作者：tobegold574（2026/9/17）
// 原因：二级 LRU，键为 (lang, code, contentStart)，缓存已换算成绝对偏移的
// token 数组。文档每次变更重建时 buildDecorations 都会重新请求所有代码块；
// 没有这一层的话，即使一级缓存全命中，每块每次仍要为每个 token 新建对象，
// 仅为做偏移 rebase。未变更的块是常态，其 rebase 数组一直有效——块内容或
// 位置任一变化都会产生新键，自然失效。
const rebasedCache = new Map<string, CodeHighlightToken[]>();

function rebasedCacheGet(key: string): CodeHighlightToken[] | undefined {
  // 作者：tobegold574（2026/9/17）
  // 原因：与上方一级缓存相同的 LRU 触碰语义——命中即删除再重插以提升
  // 活跃度，让热点条目尽量不被淘汰。
  const hit = rebasedCache.get(key);
  if (!hit) return undefined;
  rebasedCache.delete(key);
  rebasedCache.set(key, hit);
  return hit;
}

function rebasedCacheSet(key: string, value: CodeHighlightToken[]): void {
  // 作者：tobegold574（2026/9/17）
  // 原因：超限即淘汰 Map 首项（最久未命中的条目），上限与一级缓存一致。
  rebasedCache.set(key, value);
  if (rebasedCache.size > CACHE_LIMIT) {
    const oldest = rebasedCache.keys().next().value;
    if (oldest !== undefined) rebasedCache.delete(oldest);
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

  // 作者：tobegold574（2026/9/17）
  // 原因：先查二级缓存——rebase 键里含 contentStart，命中说明同一块在文档
  // 同一位置被重复请求（打字期间未变更块的常态），直接返回已换算好绝对偏移
  // 的数组，一级缓存查找与逐 token 重 rebase 全部省掉；contentStart=0 时
  // 无需 rebase，天然走一级缓存原数组。
  const baseKey = `${lang}\u0000${code}`;
  const rebaseKey = contentStart === 0 ? null : `${baseKey}\u0000${contentStart}`;
  if (rebaseKey) {
    const rebased = rebasedCacheGet(rebaseKey);
    if (rebased) return rebased;
  }

  const cached = cacheGet(baseKey);
  if (cached) {
    if (contentStart === 0) return cached;
    // 作者：tobegold574（2026/9/17）
    // 原因：一级缓存里的 token 以 contentStart=0 存放；读取时 rebase 一份并
    // 记入二级缓存，让文档其他位置打字时的重复读取零分配。
    const rebased = cached.map((t) => ({ from: t.from + contentStart, to: t.to + contentStart, className: t.className }));
    rebasedCacheSet(rebaseKey!, rebased);
    return rebased;
  }

  let result: { _emitter: unknown };
  try {
    result = hljs.highlight(code, { language: lang }) as unknown as { _emitter: unknown };
  } catch {
    return [];
  }

  const tokens: CodeHighlightToken[] = [];
  emit(result._emitter, 0, tokens);
  cacheSet(baseKey, tokens);
  if (contentStart === 0) return tokens;
  // 作者：tobegold574（2026/9/17）
  // 原因：冷解析后的首次 rebase 也写入二级缓存——此后相同的
  // (lang, code, contentStart) 请求即可零分配复用。
  const rebased = tokens.map((t) => ({ from: t.from + contentStart, to: t.to + contentStart, className: t.className }));
  rebasedCacheSet(rebaseKey!, rebased);
  return rebased;
}

// 作者：tobegold574（2026/9/17）
// 原因：hljs 内部令牌流的遍历器。`_emitter.rootNode` 是 TokenTree：叶子为
// 字符串（无标签片段），分支携带 scope 字段（如 "keyword"、"string"），kind
// 仅作兜底。按偏移累加位置，为每个带非空 scope 的叶子产出一个
// CodeHighlightToken。（原注释写的字段名 kind 与 hljs 实际结构不符，已更正。）
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
        const className = scope.map((s) => `hljs-${s}`).join(" ");
        out.push({ from: pos, to: pos + c.length, className });
      }
      pos += c.length;
      continue;
    }
    const child = c as { kind?: string; scope?: string; children?: unknown[] };
    // 作者：tobegold574（2026/9/17）
    // 原因：修复存量 bug——hljs 令牌树分支的字段名是 scope（形如
    // {children:["const"], scope:"keyword"}），原代码检查的 kind 永远不匹配，
    // 导致 emit() 恒产出 0 个 token、代码块从未真正被高亮过。改为优先读
    // scope，保留 kind 作为对其他 hljs 构建的兜底。
    const scopeName = child && (child.scope || child.kind);
    if (child && scopeName) {
      pos = walkNode(child, pos, [...scope, scopeName], out);
    } else if (child && child.children) {
      pos = walkNode(child, pos, scope, out);
    }
  }
  return pos;
}
