/**
 * HTML → Markdown 转换的纯函数实现。
 *
 * 这一层不依赖编辑器实例，只接收 HTML 字符串、输出 Markdown 字符串，
 * 因此可以独立单测、也可以脱离插件单独复用（例如宿主想自定义粘贴预览）。
 *
 * 实现基于 `turndown` + `turndown-plugin-gfm`：后者补齐 GFM 表格、任务列表、
 * 删除线等规则，使从网页/Office 复制的内容能干净地落成 Nexus 原生的 Markdown。
 */

import TurndownService from "turndown";
import * as turndownPluginGfm from "turndown-plugin-gfm";

export type TurndownRule = {
  /** 匹配的 DOM 节点名称（小写），例如 "div"、"span"。 */
  filter: TurndownService.Filter;
  /** 替换函数：接收节点 HTML 与 TurndownService 实例，返回 Markdown 片段。 */
  replacement: TurndownService.ReplacementFunction;
};

export interface PasteConvertOptions {
  /**
   * 是否转换 `<table>` 为 GFM 表格。默认 `true`。
   * 表格转换依赖 `turndown-plugin-gfm`；关闭后表格会按行内 HTML 处理。
   */
  tables?: boolean;
  /**
   * 是否保留无法映射为 Markdown 的行内 HTML（如 `<span style="...">`）。
   * 默认 `false`：剥离这些标签、只留文本，保证产出是纯 Markdown。
   */
  keepInlineHtml?: boolean;
  /**
   * 标题转换的最大层级（1–6）。默认 `6`。
   * 超过该层级的 `<hN>` 会被降级为加粗段落，避免生成过深层级。
   */
  headingMaxLevel?: number;
  /**
   * 自定义 / 覆盖 turndown 规则。按数组顺序依次 `addRule`，
   * 后注册的同名规则会覆盖先注册的。
   */
  rules?: TurndownRule[];
}

const DEFAULT_OPTIONS: Required<Omit<PasteConvertOptions, "rules">> = {
  tables: true,
  keepInlineHtml: false,
  headingMaxLevel: 6
};

/**
 * 构造一个配置好的 TurndownService 实例。导出主要便于测试与高级复用；
 * 普通使用直接调 {@link convertHtmlToMarkdown} 即可。
 */
export function createConverter(options: PasteConvertOptions = {}): TurndownService {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const maxLevel = Math.max(1, Math.min(6, Math.trunc(opts.headingMaxLevel)));

  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined"
  });

  if (opts.tables) {
    service.use(turndownPluginGfm.gfm);
  } else {
    // 仅启用删除线 / 任务列表，跳过表格规则
    service.use(turndownPluginGfm.strikethrough);
  }

  // 超过最大层级的标题降级为加粗段落
  for (let level = maxLevel + 1; level <= 6; level++) {
    service.addRule(`heading${level}`, {
      filter: [`h${level}`] as unknown as TurndownService.Filter,
      replacement: (content) => `**${content.trim()}**\n\n`
    });
  }

  // 始终移除 <script> / <style>：从网页复制的 HTML 常带这些，落进 Markdown 毫无意义
  service.addRule("removeScriptStyle", {
    filter: ["script", "style"] as unknown as TurndownService.Filter,
    replacement: () => ""
  });

  // 行内 HTML 处理
  if (!opts.keepInlineHtml) {
    // 默认：剥离常见行内样式标签，只留文本
    service.addRule("stripInlineHtml", {
      filter: ["span", "font", "mark", "small", "sub", "sup"] as unknown as TurndownService.Filter,
      replacement: (content) => content
    });
  } else {
    // 保留：把行内标签原样输出为 HTML（连同属性）
    service.addRule("keepInlineHtml", {
      filter: ["span", "font", "mark", "small", "sub", "sup"] as unknown as TurndownService.Filter,
      replacement: (content, node) => {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const attrs = Array.from(el.attributes)
          .map((a) => ` ${a.name}="${a.value}"`)
          .join("");
        return `<${tag}${attrs}>${content}</${tag}>`;
      }
    });
  }

  if (opts.rules) {
    for (const rule of opts.rules) {
      service.addRule(
        `custom-${Math.random().toString(36).slice(2)}`,
        { filter: rule.filter, replacement: rule.replacement }
      );
    }
  }

  return service;
}

/**
 * 将 HTML 字符串转换为 Markdown。
 *
 * - 输入为空 / 仅空白时返回空串，不抛异常。
 * - 转换失败时回退为"剥离标签的纯文本"，保证粘贴永不中断。
 *
 * @param html 剪贴板中的 `text/html` 内容
 * @param options 转换选项，见 {@link PasteConvertOptions}
 */
export function convertHtmlToMarkdown(html: string, options?: PasteConvertOptions): string {
  if (!html || !html.trim()) return "";

  try {
    const service = createConverter(options);
    const md = service.turndown(html);
    // turndown 偶尔在首尾留下多余空行，规整一下
    return md.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n{3,}/g, "\n\n");
  } catch {
    // 兜底：剥离所有标签，至少把可见文本粘进去
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+\n/g, "\n")
      .trim();
  }
}
