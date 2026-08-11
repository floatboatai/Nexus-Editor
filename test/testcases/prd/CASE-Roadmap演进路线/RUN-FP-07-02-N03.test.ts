import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

describe("FP-07-02-N03: Search 插件可加载：Mod-f 打开搜索面板", () => {
  it("步骤1-3: 快捷键打开面板、输入框存在、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta gamma alpha",
      plugins: [createSearchPlugin()],
    });
    const content = container.querySelector(".cm-content") as HTMLElement;

    // 步骤1: [DOM] Mod-f（jsdom 下 Mod→Ctrl）打开搜索面板
    // 修正说明: searchKeymap 来自 @codemirror/search 的 "Mod-f"，jsdom platform 为空
    // 时 Mod 解析为 Ctrl（与 FP-02-06-N03 实测一致），故用 ctrlKey 触发。
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(container.querySelector('[data-test-id="markdown-search-bar"]')).not.toBeNull();
    // 步骤2: [DOM] 搜索输入框存在
    expect(container.querySelector('[data-test-id="markdown-search-input"]')).not.toBeNull();
    // 步骤3: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
    container.remove();
  });
});
