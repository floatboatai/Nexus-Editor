import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-F01: 多文件混合拖拽按类型分别插入图片与链接", () => {
  it("步骤1-3: 图片+文本按序插入、destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: async (file) => `assets/${file.name}`,
    });

    // 步骤1: 多文件 drop
    const aPng = new File(["img"], "a.png", { type: "image/png" });
    const bTxt = new File(["txt"], "b.txt", { type: "text/plain" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [aPng, bTxt] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // 步骤2: 图片走图片语法、非图片走链接语法
    await flushMicrotasks();
    expect(editor.getDocument()).toBe("![a.png](assets/a.png)[b.txt](assets/b.txt)");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
