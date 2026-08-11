import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

describe("FP-07-02-E02: GFM + History + Search 三插件共存互不冲突", () => {
  it("步骤1-4: 创建、GFM 生效、Search 打开、History 撤销", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let editor: ReturnType<typeof createEditor>;
    // 步骤1: [STATE] 三插件共存创建不抛异常
    // 修正说明: 不能用 expect(creator).not.toThrow() 后又创建第二次——两次 createEditor
    // 会在同一 container 产生两个 .cm-editor，querySelector 命中第一个、editor 引用第二个，
    // 事件与断言不同步。
    const creator = () => {
      editor = createEditor({
        container,
        initialValue: "| a | b |\n| - | - |\n| 1 | 2 |",
        plugins: [createGfmPreset(), createHistoryPlugin(), createSearchPlugin()],
      });
    };
    expect(creator).not.toThrow();
    editor = editor!;
    // 步骤2: [AST] GFM 表格解析生效
    expect(editor.getAst().children[0]?.type).toBe("table");
    // 步骤3: [DOM] Search 面板打开（jsdom 下 Mod→Ctrl）
    const content = container.querySelector(".cm-content") as HTMLElement;
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
    // 步骤4: [STATE] History 撤销生效
    editor.setDocument("changed");
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(editor.getDocument()).toBe("| a | b |\n| - | - |\n| 1 | 2 |");

    editor.destroy();
    container.remove();
  });
});
