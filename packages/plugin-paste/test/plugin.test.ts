/**
 * 粘贴插件集成测试。
 *
 * jsdom 不实现 ClipboardEvent / DataTransfer，因此这里手工构造一个最小
 * mock 事件对象，只实现插件用到的字段（clipboardData.getData / files / items），
 * 然后直接调用插件 `handlers.paste` 处理器，配合真实 editor 的
 * `EditorEventContext.insertMarkdown` 验证端到端插入效果。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI, type EditorEventContext } from "@floatboat/nexus-core";

import { createPastePlugin } from "../src/plugin";
import { convertHtmlToMarkdown } from "../src/convert";

/** 构造一个仅满足插件读取需求的 mock ClipboardEvent。 */
function makePasteEvent(opts: {
  html?: string;
  text?: string;
  files?: File[];
}): ClipboardEvent {
  const data: {
    html: string;
    text: string;
    files: File[];
  } = {
    html: opts.html ?? "",
    text: opts.text ?? "",
    files: opts.files ?? []
  };

  const clipboardData = {
    getData: vi.fn((type: string) => {
      if (type === "text/html") return data.html;
      if (type === "text/plain") return data.text;
      return "";
    }),
    get files() {
      return data.files;
    },
    get items() {
      return data.files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
    }
  };

  const event = {
    type: "paste",
    clipboardData,
    preventDefault: vi.fn(),
    defaultPrevented: false
  } as unknown as ClipboardEvent;

  return event;
}

/** 构造一个绑定到真实 editor 的 EditorEventContext，复用 core 的 insertMarkdown 语义。 */
function makeContext(editor: EditorAPI): EditorEventContext {
  return {
    editor,
    insertMarkdown: (markdown: string) => {
      // 复用 core 事件上下文里的"替换当前选区"语义：replaceRange(from, to, insert)
      const { anchor, head } = editor.getSelection();
      editor.replaceRange(Math.min(anchor, head), Math.max(anchor, head), markdown);
    },
    uploadAsset: (file: File) => editor.uploadAsset(file)
  };
}

describe("createPastePlugin — handlers.paste", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  it("HTML 粘贴 → 转为 Markdown 并插入文档", () => {
    const plugin = createPastePlugin();
    editor = createEditor({
      container,
      initialValue: "",
      plugins: [plugin]
    });

    const event = makePasteEvent({ html: "<h1>Title</h1><p>Body <b>bold</b></p>" });
    const consumed = plugin.handlers!.paste!(event, makeContext(editor));

    expect(consumed).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    const doc = editor.getDocument();
    expect(doc).toContain("# Title");
    expect(doc).toContain("**bold**");
  });

  it("无 text/html 时放行（返回 false，不阻止默认）", () => {
    const plugin = createPastePlugin();
    editor = createEditor({ container, initialValue: "before", plugins: [plugin] });

    const event = makePasteEvent({ text: "plain only" });
    const consumed = plugin.handlers!.paste!(event, makeContext(editor));

    expect(consumed).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    // 文档未被插件改动
    expect(editor.getDocument()).toBe("before");
  });

  it("文件粘贴（图片）放行，交给 core 上传管线", () => {
    const plugin = createPastePlugin();
    editor = createEditor({ container, initialValue: "", plugins: [plugin] });

    const file = new File(["data"], "img.png", { type: "image/png" });
    const event = makePasteEvent({ html: "<img src='x'>", files: [file] });
    const consumed = plugin.handlers!.paste!(event, makeContext(editor));

    expect(consumed).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("shouldConvert 返回 false 时放行", () => {
    editor = createEditor({ container, initialValue: "x", plugins: [] });

    const plugin = createPastePlugin({ shouldConvert: () => false });
    const event = makePasteEvent({ html: "<b>hi</b>" });
    const consumed = plugin.handlers!.paste!(event, makeContext(editor));

    expect(consumed).toBe(false);
    expect(editor.getDocument()).toBe("x");
  });

  it("转换为空时放行，不调用 insertMarkdown", () => {
    editor = createEditor({ container, initialValue: "keep", plugins: [] });

    const plugin = createPastePlugin();
    // 只有空白 HTML → convertHtmlToMarkdown 返回 ""
    const event = makePasteEvent({ html: "   " });
    const ctx = makeContext(editor);
    const spy = vi.spyOn(ctx, "insertMarkdown");

    const consumed = plugin.handlers!.paste!(event, ctx);

    expect(consumed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(editor.getDocument()).toBe("keep");
  });

  it("转换结果与 convertHtmlToMarkdown 一致（端到端一致性）", () => {
    editor = createEditor({ container, initialValue: "", plugins: [] });
    const plugin = createPastePlugin({ tables: true });

    const html = "<ul><li>a</li><li>b</li></ul>";
    const event = makePasteEvent({ html });
    plugin.handlers!.paste!(event, makeContext(editor));

    const expected = convertHtmlToMarkdown(html, { tables: true });
    expect(editor.getDocument()).toBe(expected);
  });

  it("插件是合法的 NexusPlugin（带 name 与 handlers）", () => {
    const plugin = createPastePlugin();
    expect(plugin.name).toBe("plugin-paste");
    expect(typeof plugin.handlers?.paste).toBe("function");
  });
});
