/**
 * 真实端到端验证：把插件挂进 createEditor，向编辑器 DOM 真实派发 paste 事件，
 * 验证 core 的事件派发 → 插件 handlers.paste → insertMarkdown → 文档更新 全链路打通。
 *
 * 这不是常驻单测（jsdom 的 ClipboardEvent 支持有限），而是一次性验证脚本。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createPastePlugin } from "../src/plugin";

// ── jsdom 不实现 DataTransfer / ClipboardEvent，这里做最小 polyfill ──
// 只需满足：构造 ClipboardEvent 时携带可 getData 的 clipboardData。
class DataTransferShim {
  private data = new Map<string, string>();
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
  get files() {
    return [] as File[];
  }
  get items() {
    return [];
  }
  get types() {
    return Array.from(this.data.keys());
  }
}

class ClipboardEventShim extends Event {
  clipboardData: DataTransferShim;
  constructor(type: string, init: { clipboardData?: DataTransferShim; bubbles?: boolean; cancelable?: boolean } = {}) {
    super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
    this.clipboardData = init.clipboardData ?? new DataTransferShim();
  }
}

const DataTransferPolyfill = (globalThis as { DataTransfer?: unknown }).DataTransfer;
const ClipboardEventPolyfill = (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent;
beforeEach(() => {
  (globalThis as { DataTransfer?: unknown }).DataTransfer = DataTransferShim;
  (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = ClipboardEventShim as unknown as typeof ClipboardEvent;
});
afterEach(() => {
  (globalThis as { DataTransfer?: unknown }).DataTransfer = DataTransferPolyfill;
  (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = ClipboardEventPolyfill;
});

describe("plugin-paste 真实 DOM 事件端到端", () => {
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

  it("向编辑器 DOM 派发带 text/html 的 paste 事件 → 文档变为 Markdown", () => {
    editor = createEditor({
      container,
      initialValue: "",
      plugins: [createPastePlugin()]
    });
    editor.focus();

    const dt = new DataTransferShim();
    dt.setData("text/html", "<h2>From Web</h2><p>Pasted <strong>rich</strong> text</p>");
    dt.setData("text/plain", "From Web Pasted rich text");

    const event = new ClipboardEventShim("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });

    const cmEl = container.querySelector(".cm-content") as HTMLElement;
    expect(cmEl, "应找到 CodeMirror 内容元素").toBeTruthy();
    cmEl.dispatchEvent(event);

    const doc = editor.getDocument();
    expect(doc).toContain("## From Web");
    expect(doc).toContain("**rich**");
    expect(doc).not.toContain("<h2>");
    expect(doc).not.toContain("<strong>");
  });

  it("纯文本 paste（无 text/html）→ 文档不被插件改写成 Markdown", () => {
    editor = createEditor({
      container,
      initialValue: "",
      plugins: [createPastePlugin()]
    });
    editor.focus();

    const dt = new DataTransferShim();
    dt.setData("text/plain", "just plain");

    const event = new ClipboardEventShim("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });

    const cmEl = container.querySelector(".cm-content") as HTMLElement;
    cmEl.dispatchEvent(event);

    // 关键行为断言：插件未把纯文本当 HTML 转换，文档不应出现 markdown 标记
    const doc = editor.getDocument();
    expect(doc).not.toContain("**");
    expect(doc).not.toContain("##");
  });
});

