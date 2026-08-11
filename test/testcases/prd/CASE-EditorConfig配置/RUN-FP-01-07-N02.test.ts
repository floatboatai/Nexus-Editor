import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-N02: 拖拽图片文件到编辑器插入 markdown 图片语法", () => {
  it("步骤1-3: drop 消费、图片语法插入、destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: async (file) => `assets/${file.name}`,
    });

    // 步骤1: 派发 drop 事件
    const imgFile = new File(["img"], "a.png", { type: "image/png" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [imgFile] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // 步骤2: 图片语法插入
    await flushMicrotasks();
    expect(editor.getDocument()).toBe("![a.png](assets/a.png)");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
