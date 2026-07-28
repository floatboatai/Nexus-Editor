/**
 * Nexus 粘贴插件：把剪贴板里的富文本 HTML 自动转成 Markdown 再插入。
 *
 * 工作方式：注册 core 已预留的 `handlers.paste` 钩子（见 `@floatboat/nexus-core`
 * 的 `EditorEventHandlers`）。当剪贴板包含 `text/html` 时，调用
 * {@link convertHtmlToMarkdown} 转换后用 `ctx.insertMarkdown` 插入；否则放行，
 * 交回 core 的默认逻辑（图片/文件上传，或 CodeMirror 的纯文本粘贴）。
 *
 * 设计约束（来自 core 的约定）：
 * - 处理器返回 `true` 表示已消费 → core 阻止默认行为并停止派发；
 *   返回 `false`/`undefined` 表示放行。
 * - 文件类粘贴（图片、附件）必须放行，让 core 的 `onAssetUpload` 管线接管，
 *   不与本插件抢事件。
 */

import type { EditorEventContext, NexusPlugin } from "@floatboat/nexus-core";

import { convertHtmlToMarkdown, type PasteConvertOptions } from "./convert";

export interface PastePluginOptions extends PasteConvertOptions {
  /**
   * 自定义"是否对该次粘贴启用 HTML→Markdown 转换"的判断。
   *
   * 默认：剪贴板含 `text/html` 即启用。返回 `false` 时插件放行，事件回到 core。
   * 可用于"只在特定来源启用"或"粘贴前弹确认"等场景。
   */
  shouldConvert?: (event: ClipboardEvent) => boolean;
}

export type PastePlugin = NexusPlugin;

/** 剪贴板里是否带文件（图片/附件）——有则交给 core 上传管线，本插件不抢。 */
function hasFiles(event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  if (data.files && data.files.length > 0) return true;
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") return true;
    }
  }
  return false;
}

/**
 * 创建粘贴插件。返回值可直接传入 `createEditor({ plugins: [...] })`：
 *
 * ```ts
 * import { createEditor } from "@floatboat/nexus-core";
 * import { createPastePlugin } from "@floatboat/nexus-plugin-paste";
 *
 * const editor = createEditor({
 *   container,
 *   plugins: [createPastePlugin()],
 * });
 * ```
 */
export function createPastePlugin(options: PastePluginOptions = {}): PastePlugin {
  const shouldConvert = options.shouldConvert;

  return {
    name: "plugin-paste",
    handlers: {
      paste(event: ClipboardEvent, ctx: EditorEventContext): boolean {
        // 1. 文件类粘贴（图片/附件）→ 放行，交给 core 上传管线
        if (hasFiles(event)) return false;

        // 2. 没有 text/html → 放行，让 CodeMirror 做纯文本粘贴
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (!html) return false;

        // 3. 自定义闸门
        if (shouldConvert && shouldConvert(event) === false) return false;

        // 4. 转换并插入；转换为空则放行
        const markdown = convertHtmlToMarkdown(html, options);
        if (!markdown) return false;

        event.preventDefault();
        ctx.insertMarkdown(markdown);
        return true;
      }
    }
  };
}
