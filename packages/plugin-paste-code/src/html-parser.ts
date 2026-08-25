/**
 * 从剪贴板 HTML 中提取代码块并转换为 Markdown。
 *
 * 支持的 HTML 结构：
 * - <pre><code class="language-javascript">code</code></pre>
 * - <pre><code class="lang-js">code</code></pre>
 * - <div class="highlight"><pre>code</pre></div>
 * - 纯 <pre>code</pre>
 */

export interface CodeBlock {
  /** 代码语言，未识别时为 null */
  language: string | null;
  /** 代码内容（纯文本，已反转义 HTML 实体） */
  code: string;
}

export interface ParseResult {
  /** 是否包含代码块 */
  hasCode: boolean;
  /** 转换后的 Markdown 文本 */
  markdown: string;
  /** 提取到的代码块列表 */
  codeBlocks: CodeBlock[];
}

/**
 * 从 class 属性中提取语言标识。
 * 支持：language-javascript, lang-js, brush: js, 等
 */
export function extractLanguageFromClass(className: string | null): string | null {
  if (!className) return null;

  const classes = className.split(/\s+/);
  for (const cls of classes) {
    // language-xxx
    const langMatch = cls.match(/^(?:language|lang)-(.+)$/i);
    if (langMatch) {
      return normalizeLanguage(langMatch[1]);
    }
    // brush: xxx (SyntaxHighlighter 风格)
    const brushMatch = cls.match(/^brush[:-](.+)$/i);
    if (brushMatch) {
      return normalizeLanguage(brushMatch[1]);
    }
  }

  return null;
}

/**
 * 规范化语言名称，处理别名和大小写。
 */
function normalizeLanguage(lang: string): string {
  const lower = lang.toLowerCase().trim();
  const aliasMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    "c++": "cpp",
    "c#": "csharp",
    cs: "csharp",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    tf: "hcl",
    golang: "go",
    objectivec: "objective-c",
    objc: "objective-c",
    "objective-c++": "objective-cpp",
  };
  return aliasMap[lower] || lower;
}

/**
 * 反转义 HTML 实体。
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * 从一个元素中提取代码块信息。
 */
function extractCodeBlockFromElement(el: Element): CodeBlock | null {
  // 优先找 <code> 子元素
  const codeEl = el.querySelector("code");
  const targetEl = codeEl || el;

  const language = extractLanguageFromClass(codeEl?.className || null);
  const code = decodeHtmlEntities(targetEl.textContent || "");

  // 去掉首尾的空行
  const trimmedCode = code.replace(/^\n+/, "").replace(/\n+$/, "");

  if (!trimmedCode) return null;

  return { language, code: trimmedCode };
}

/**
 * 将代码块转为 Markdown fenced code block。
 */
function codeBlockToMarkdown(block: CodeBlock): string {
  const lang = block.language || "";
  return `\`\`\`${lang}\n${block.code}\n\`\`\``;
}

/**
 * 递归遍历 DOM，将元素转换为 Markdown 文本。
 * 遇到 <pre> 就转成代码块，其他元素保留文本。
 */
function nodeToMarkdown(node: Node, result: { text: string; codeBlocks: CodeBlock[] }): void {
  if (node.nodeType === Node.TEXT_NODE) {
    result.text += node.textContent || "";
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;

  // 遇到 <pre> 标签，当作代码块处理
  if (el.tagName === "PRE") {
    const block = extractCodeBlockFromElement(el);
    if (block) {
      result.text += codeBlockToMarkdown(block);
      result.codeBlocks.push(block);
      return; // 不继续遍历子元素
    }
  }

  // 块级元素前后加换行
  const blockTags = new Set(["DIV", "P", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "BLOCKQUOTE"]);
  const isBlock = blockTags.has(el.tagName);

  if (isBlock) result.text += "\n";

  // 递归处理子节点
  for (const child of Array.from(el.childNodes)) {
    nodeToMarkdown(child, result);
  }

  if (isBlock) result.text += "\n";
}

/**
 * 解析剪贴板 HTML，提取代码块并转换为 Markdown。
 *
 * @param html 剪贴板中的 HTML 字符串
 * @returns 解析结果，包含是否有代码、转换后的 Markdown、代码块列表
 */
export function parseHtmlForCodeBlocks(html: string): ParseResult {
  if (!html || !html.trim()) {
    return { hasCode: false, markdown: "", codeBlocks: [] };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const result = { text: "", codeBlocks: [] as CodeBlock[] };

  // 从 body 开始遍历
  for (const child of Array.from(doc.body.childNodes)) {
    nodeToMarkdown(child, result);
  }

  // 清理多余的空行（超过 2 个连续换行压缩为 2 个）
  const markdown = result.text.replace(/\n{3,}/g, "\n\n").trim();

  return {
    hasCode: result.codeBlocks.length > 0,
    markdown,
    codeBlocks: result.codeBlocks,
  };
}
