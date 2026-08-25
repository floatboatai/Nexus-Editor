import type { NexusPlugin } from "@floatboat/nexus-core";

import { parseHtmlForCodeBlocks, extractLanguageFromClass, decodeHtmlEntities } from "./html-parser";
import { detectCodeLanguage } from "./language-detector";
import { convertHtmlToMarkdown } from "./html-to-markdown";

export interface PasteCodePluginOptions {
  /**
   * 是否启用纯文本代码检测。
   * 当剪贴板没有 HTML 格式时，尝试检测纯文本是否是代码。
   * 默认：true
   */
  detectPlainText?: boolean;

  /**
   * 纯文本代码检测的最低置信度阈值（0-1）。
   * 低于此阈值的纯文本不会被转成代码块。
   * 默认：0.5
   */
  plainTextConfidenceThreshold?: number;

  /**
   * 是否保留粘贴内容的样式（加粗、斜体、标题、列表、表格、图片、引用块等）。
   * 当启用时，会将整个 HTML 内容转换为 Markdown，保留所有样式。
   * 当禁用时（默认），只处理代码块，其他内容放行默认粘贴。
   * 默认：false
   */
  preserveFormatting?: boolean;

  /**
   * 转换前的回调，可以修改转换后的 Markdown 或跳过转换。
   * 返回 false 表示跳过转换，使用默认粘贴行为。
   */
  beforeConvert?: (markdown: string, codeBlocks: Array<{ language: string | null; code: string }>) => string | false;
}

/**
 * 创建粘贴代码自动转换插件。
 *
 * 功能：
 * - 从网页复制代码（带 HTML 格式）时，自动识别语言并转成 Markdown 代码块
 * - 支持从终端/纯文本复制的代码自动检测语言（可选）
 * - 支持文字+代码混合粘贴
 *
 * @example
 * ```ts
 * import { createEditor } from "@floatboat/nexus-core";
 * import { createPasteCodePlugin } from "@floatboat/nexus-plugin-paste-code";
 *
 * const editor = createEditor({
 *   container,
 *   plugins: [createPasteCodePlugin()],
 * });
 * ```
 */
export function createPasteCodePlugin(options: PasteCodePluginOptions = {}): NexusPlugin {
  const {
    detectPlainText = true,
    plainTextConfidenceThreshold = 0.5,
    preserveFormatting = false,
    beforeConvert,
  } = options;

  return {
    name: "plugin-paste-code",

    handlers: {
      paste(event, ctx) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 1. 优先尝试 HTML 格式（从网页复制的代码通常带 HTML）
        const html = clipboardData.getData("text/html");
        if (html && html.trim()) {
          // 如果启用了样式保留，将整个 HTML 转换为 Markdown
          if (preserveFormatting) {
            // 只有当 HTML 里有丰富样式时才用样式保留模式
            // 如果只是普通文本（没有加粗、标题、列表等），继续走纯文本代码检测
            if (hasRichFormatting(html)) {
              const markdown = convertHtmlToMarkdown(html);
              if (markdown && markdown.trim()) {
                // 提取代码块信息（用于 beforeConvert 回调）
                const codeBlockResult = parseHtmlForCodeBlocks(html);

                let finalMarkdown = markdown;
                if (beforeConvert) {
                  const converted = beforeConvert(markdown, codeBlockResult.codeBlocks);
                  if (converted === false) {
                    return false;
                  }
                  finalMarkdown = converted;
                }

                ctx.insertMarkdown(finalMarkdown);
                return true;
              }
            }
          }

          // 默认行为：只提取代码块
          const result = parseHtmlForCodeBlocks(html);

          if (result.hasCode && result.markdown) {
            // 调用 beforeConvert 回调
            let finalMarkdown = result.markdown;
            if (beforeConvert) {
              const converted = beforeConvert(result.markdown, result.codeBlocks);
              if (converted === false) {
                return false; // 跳过转换，使用默认行为
              }
              finalMarkdown = converted;
            }

            ctx.insertMarkdown(finalMarkdown);
            return true; // 消费事件，阻止默认粘贴
          }
        }

        // 2. 尝试纯文本格式（从终端/编辑器复制的代码）
        if (detectPlainText) {
          const text = clipboardData.getData("text/plain");
          if (text && text.trim()) {
            const detection = detectCodeLanguage(text);

            if (detection.isCode && detection.confidence >= plainTextConfidenceThreshold) {
              // 分离开头的非代码行（文字部分）和代码部分
              const { textPart, codePart } = splitTextAndCode(text);
              const lang = detection.language || "";

              let markdown = "";
              const codeBlocks: Array<{ language: string | null; code: string }> = [];

              // 如果有文字部分，先加文字
              if (textPart.trim()) {
                markdown += textPart.trim() + "\n\n";
              }

              // 代码部分包成代码块
              if (codePart.trim()) {
                markdown += `\`\`\`${lang}\n${codePart.replace(/\n+$/, "")}\n\`\`\``;
                codeBlocks.push({ language: detection.language, code: codePart });
              }

              // 如果没有分离出代码部分（整个文本都是文字），放行默认粘贴
              if (!codePart.trim()) {
                return false;
              }

              // 调用 beforeConvert 回调
              let finalMarkdown = markdown;
              if (beforeConvert) {
                const converted = beforeConvert(markdown, codeBlocks);
                if (converted === false) {
                  return false;
                }
                finalMarkdown = converted;
              }

              ctx.insertMarkdown(finalMarkdown);
              return true;
            }
          }
        }

        // 3. 都不匹配，放行默认粘贴行为
        return false;
      },
    },
  };
}

export { parseHtmlForCodeBlocks, extractLanguageFromClass, decodeHtmlEntities, detectCodeLanguage, convertHtmlToMarkdown };
export type { CodeBlock, ParseResult } from "./html-parser";
export type { TextDetectionResult } from "./language-detector";

/**
 * 分离纯文本中的文字部分和代码部分。
 *
 * 逻辑：
 * 1. 按行分割
 * 2. 对于每一行，如果整行不像代码，归为文字部分
 * 3. 如果整行像代码，检查开头是否有非代码部分（如中文文字），如果有则行内分割
 * 4. 一旦遇到代码，后面的都归为代码部分
 */
function splitTextAndCode(text: string): { textPart: string; codePart: string } {
  const lines = text.split("\n");
  const textLines: string[] = [];
  const codeLines: string[] = [];
  let foundCode = false;

  for (const line of lines) {
    if (!foundCode) {
      if (isCodeLine(line)) {
        // 尝试行内分割：检查开头是否有非代码部分（如中文文字）
        const { textPart: inlineText, codePart: inlineCode } = splitLineTextAndCode(line);
        if (inlineText.trim()) {
          textLines.push(inlineText);
        }
        if (inlineCode.trim()) {
          foundCode = true;
          codeLines.push(inlineCode);
        } else {
          // 没有代码部分，整行都是文字
          textLines.push(line);
        }
      } else {
        textLines.push(line);
      }
    } else {
      codeLines.push(line);
    }
  }

  return {
    textPart: textLines.join("\n"),
    codePart: codeLines.join("\n"),
  };
}

/**
 * 行内分割：分离一行开头的文字部分和后面的代码部分。
 *
 * 例如："我是我 public function($a){return true;}"
 * → textPart: "我是我 ", codePart: "public function($a){return true;}"
 */
function splitLineTextAndCode(line: string): { textPart: string; codePart: string } {
  const trimmed = line.trimStart();
  const leadingSpaces = line.length - trimmed.length;

  // 找到第一个代码关键字或代码符号的位置
  const codePattern = /\b(function|class|def|func|import|export|return|if|else|for|while|public|private|protected|const|let|var|package|interface|type|enum|struct|impl|fn|mut|match|case|break|continue|try|catch|finally|throw|new|this|self|super|extends|implements|static|final|abstract|void|async|await|yield)\b|[{}();=]|=>|\$\w+/i;
  const match = trimmed.match(codePattern);

  if (!match || match.index === undefined || match.index === 0) {
    // 没有找到代码模式，或者代码从开头开始，整行都是代码
    return { textPart: "", codePart: line };
  }

  const splitPos = leadingSpaces + match.index;
  const textPart = line.slice(0, splitPos);
  const codePart = line.slice(splitPos);

  // 检查文字部分是否真的是文字（不是代码的一部分）
  // 如果文字部分包含代码符号，说明不应该分割
  if (/[{}();=]|=>|\$\w+/.test(textPart)) {
    return { textPart: "", codePart: line };
  }

  return { textPart, codePart };
}

/**
 * 判断一行是否像代码。
 */
function isCodeLine(line: string): boolean {
  const trimmed = line.trim();

  // 空行不像代码（但会根据上下文处理）
  if (!trimmed) return false;

  // 包含代码符号
  const codeSymbols = /[{}();=]|=>|\$\w+|\/\/|^\s*#|^\s*\*/;
  if (codeSymbols.test(trimmed)) return true;

  // 包含代码关键字
  const codeKeywords = /\b(function|class|def|func|import|export|return|if|else|for|while|public|private|protected|const|let|var|package|interface|type|enum|struct|impl|fn|let|mut|match|case|break|continue|try|catch|finally|throw|new|this|self|super|extends|implements|static|final|abstract|void|async|await|yield)\b/i;
  if (codeKeywords.test(trimmed)) return true;

  // 纯中文行（没有任何英文字母和代码符号）不像代码
  const hasEnglish = /[a-zA-Z]/.test(trimmed);
  if (!hasEnglish) return false;

  // 包含冒号（可能是 YAML、Python 等）
  if (/:\s*$/.test(trimmed) || /:\s+/.test(trimmed)) return true;

  // 其他情况默认不像代码
  return false;
}

/**
 * 检查 HTML 里是否包含丰富的样式。
 *
 * 用于判断是否应该用样式保留模式。
 * 如果只有普通文本（没有加粗、标题、列表等），应该继续走纯文本代码检测。
 *
 * 检查内容：
 * - 加粗、斜体、删除线、下划线标签
 * - 标题标签 h1-h6
 * - 列表标签 ul、ol
 * - 表格标签 table
 * - 图片标签 img
 * - 引用块标签 blockquote
 * - 代码块标签 pre、code
 * - 内联样式 font-weight、font-style、text-decoration
 */
function hasRichFormatting(html: string): boolean {
  if (!html) return false;

  // 检查语义化标签
  const richTags = /<(b|strong|i|em|u|s|del|strike|h[1-6]|ul|ol|table|img|blockquote|pre|code|a|hr|br)\b/i;
  if (richTags.test(html)) return true;

  // 检查内联样式
  const richStyles = /style\s*=\s*["'][^"']*(font-weight|font-style|text-decoration|background|border|text-align|font-size)[^"']*["']/i;
  if (richStyles.test(html)) return true;

  return false;
}
