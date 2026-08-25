import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * HTML 转 Markdown 服务。
 *
 * 支持：
 * - 加粗、斜体、删除线
 * - 标题（h1-h6）
 * - 有序/无序列表
 * - 链接
 * - 图片
 * - 引用块
 * - 代码块（自动识别语言）
 * - 表格（GFM）
 */

let turndownService: TurndownService | null = null;

function getTurndownService(): TurndownService {
  if (turndownService) return turndownService;

  const service = new TurndownService({
    headingStyle: "atx", // # 标题风格
    codeBlockStyle: "fenced", // ``` 代码块风格
    bulletListMarker: "-", // 无序列表标记
    emDelimiter: "*", // 斜体标记
    strongDelimiter: "**", // 加粗标记
  });

  // 启用 GFM 插件（表格、删除线、任务列表等）
  service.use(gfm);

  // 自定义代码块规则：增强语言识别
  // 覆盖默认的 fenced code block 规则，支持更多语言 class 格式
  service.addRule("enhancedCodeBlock", {
    filter: function (node) {
      return (
        node.nodeName === "PRE" &&
        node.querySelector("code") !== null
      );
    },
    replacement: function (_content, node) {
      const codeNode = node.querySelector("code");
      if (!codeNode) {
        return "```\n" + node.textContent + "\n```\n\n";
      }

      // 从 class 提取语言
      const className = codeNode.getAttribute("class") || "";
      const language = extractLanguageFromClass(className);

      // 获取代码内容，去除首尾空行
      let code = codeNode.textContent || "";
      code = code.replace(/^\n+/, "").replace(/\n+$/, "");

      if (language) {
        return "```" + language + "\n" + code + "\n```\n\n";
      }
      return "```\n" + code + "\n```\n\n";
    },
  });

  // 自定义行内代码规则
  service.addRule("inlineCode", {
    filter: function (node) {
      return (
        node.nodeName === "CODE" &&
        node.parentNode?.nodeName !== "PRE"
      );
    },
    replacement: function (content) {
      return "`" + content + "`";
    },
  });

  // 内联样式：加粗（font-weight: bold / 700/800/900）
  // 处理腾讯文档、WPS 等使用 style="font-weight: bold" 而非 <strong> 的情况
  service.addRule("inlineBoldStyle", {
    filter: function (node) {
      if (node.nodeName === "STRONG" || node.nodeName === "B") return false;
      const style = node.getAttribute("style") || "";
      return /font-weight\s*:\s*(bold|700|800|900)/i.test(style);
    },
    replacement: function (content) {
      return "**" + content + "**";
    },
  });

  // 内联样式：斜体（font-style: italic）
  service.addRule("inlineItalicStyle", {
    filter: function (node) {
      if (node.nodeName === "EM" || node.nodeName === "I") return false;
      const style = node.getAttribute("style") || "";
      return /font-style\s*:\s*italic/i.test(style);
    },
    replacement: function (content) {
      return "*" + content + "*";
    },
  });

  // 内联样式：删除线（text-decoration: line-through）
  service.addRule("inlineStrikethroughStyle", {
    filter: function (node) {
      if (node.nodeName === "DEL" || node.nodeName === "S" || node.nodeName === "STRIKE") return false;
      const style = node.getAttribute("style") || "";
      return /text-decoration\s*:\s*line-through/i.test(style);
    },
    replacement: function (content) {
      return "~~" + content + "~~";
    },
  });

  // 内联样式：下划线（text-decoration: underline）
  // Markdown 不原生支持下划线，用 HTML 标签
  service.addRule("inlineUnderlineStyle", {
    filter: function (node) {
      if (node.nodeName === "U") return false;
      const style = node.getAttribute("style") || "";
      return /text-decoration\s*:\s*underline/i.test(style);
    },
    replacement: function (content) {
      return "<u>" + content + "</u>";
    },
  });

  turndownService = service;
  return service;
}

/**
 * 从 CSS class 中提取编程语言。
 * 支持格式：
 * - language-javascript / lang-js
 * - brush: python / highlight-python
 * - prettyprint lang-java
 */
function extractLanguageFromClass(className: string): string | null {
  if (!className) return null;

  // 常见的语言 class 模式
  const patterns = [
    /language-([\w+-]+)/i, // language-javascript
    /lang-([\w+-]+)/i, // lang-js
    /brush:\s*([\w+-]+)/i, // brush: python
    /highlight-([\w+-]+)/i, // highlight-python
    /prettyprint\s+lang-([\w+-]+)/i, // prettyprint lang-java
    /\b(js|javascript|ts|typescript|py|python|java|go|golang|rust|rs|c|cpp|c\+\+|csharp|cs|php|ruby|rb|swift|kotlin|kt|bash|sh|shell|sql|json|yaml|yml|html|xml|css|scss|less|markdown|md)\b/i, // 直接的语言名
  ];

  for (const pattern of patterns) {
    const match = className.match(pattern);
    if (match) {
      return normalizeLanguage(match[1].toLowerCase());
    }
  }

  return null;
}

/**
 * 语言别名归一化。
 */
function normalizeLanguage(lang: string): string {
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    golang: "go",
    rs: "rust",
    "c++": "cpp",
    csharp: "cs",
    rb: "ruby",
    kt: "kotlin",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    md: "markdown",
  };
  return aliases[lang] || lang;
}

/**
 * 预处理 HTML，清理 WPS/Word 等文档粘贴时产生的垃圾内容。
 *
 * 处理内容：
 * - 去掉 HTML 注释
 * - 去掉 <meta>、<style>、<link>、<o:p> 等标签
 * - 去掉黑色文字的 span（color: #000000 / black），只保留内容
 * - 去掉空的 span
 */
function preprocessHtml(html: string): string {
  if (!html) return "";

  let result = html;

  // 1. 去掉 HTML 注释
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // 2. 去掉 <meta>、<style>、<link>、<o:p> 等标签
  result = result.replace(/<meta[^>]*>/gi, "");
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  result = result.replace(/<link[^>]*>/gi, "");
  result = result.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, "");
  result = result.replace(/<\/?o:p[^>]*>/gi, "");

  // 3. 去掉黑色文字的 span（color: #000000 / #000 / black / rgb(0,0,0)）
  // 只保留 span 的内容
  result = result.replace(
    /<span[^>]*style\s*=\s*["'][^"']*color\s*:\s*(#000000|#000|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    "$2"
  );

  // 4. 去掉空的 span（没有属性或只有 class 的空 span）
  result = result.replace(/<span[^>]*>\s*<\/span>/gi, "");

  // 5. 去掉只有 class 没有 style 的 span（WPS 常用的无用 class）
  result = result.replace(
    /<span\s+class\s*=\s*["'][^"']*["']\s*>([\s\S]*?)<\/span>/gi,
    "$1"
  );

  // 6. 去掉只带颜色样式（没有加粗/斜体/删除线/下划线）的 span
  // 颜色在 Markdown 里支持不好，保留会导致 HTML 标签被直接显示
  result = result.replace(
    /<span[^>]*style\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    function (match, style, content) {
      const styleLower = style.toLowerCase();
      // 检查是否有除了 color 之外的其他样式
      const hasOtherStyle = /font-weight|font-style|text-decoration|background|border|padding|margin|font-size|line-height|text-align/i.test(styleLower);
      // 如果只有 color 样式，去掉 span，只保留内容
      if (!hasOtherStyle && /color\s*:/i.test(styleLower)) {
        return content;
      }
      // 有其他样式，保留 span 让后续规则处理
      return match;
    }
  );

  return result;
}

/**
 * 后处理 Markdown，修复常见问题。
 *
 * 处理内容：
 * - 修复有序列表的转义（1\. → 1.）
 * - 把 • 符号转成无序列表标记 -
 * - 清理多余的空行
 */
function postprocessMarkdown(markdown: string): string {
  if (!markdown) return "";

  let result = markdown;

  // 1. 修复有序列表的转义（1\. → 1.）
  // 不要求行首，只要是数字+反斜杠+点+空白就替换
  result = result.replace(/(\d+)\\\.\s+/g, "$1. ");

  // 2. 把 • 符号转成无序列表标记 -
  result = result.replace(/^(\s*)•\s+/gm, "$1- ");

  // 3. 清理多余的空行（最多保留 2 个连续换行）
  result = result.replace(/\n{3,}/g, "\n\n");

  // 4. 去除首尾空白
  result = result.trim();

  return result;
}

/**
 * 将 HTML 字符串转换为 Markdown。
 *
 * @param html HTML 字符串
 * @returns Markdown 字符串
 */
export function convertHtmlToMarkdown(html: string): string {
  if (!html || !html.trim()) {
    return "";
  }

  // 预处理 HTML
  const cleanedHtml = preprocessHtml(html);

  const service = getTurndownService();
  let markdown = service.turndown(cleanedHtml);

  // 后处理 Markdown
  markdown = postprocessMarkdown(markdown);

  return markdown;
}

/**
 * 检查 HTML 中是否包含代码块。
 */
export function hasCodeBlock(html: string): boolean {
  return /<pre[\s>]/i.test(html) || /<code[\s>]/i.test(html);
}
