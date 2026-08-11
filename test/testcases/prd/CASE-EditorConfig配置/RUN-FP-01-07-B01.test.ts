import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-B01: 非图片类型文件（text/plain）拖拽插入为链接语法", () => {
  it("步骤1-3: drop 消费、链接语法、destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: async (file) => `assets/${file.name}`,
    });

    // 步骤1: text/plain drop
    const txtFile = new File(["doc"], "doc.txt", { type: "text/plain" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [txtFile] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // 步骤2: 链接语法
    await flushMicrotasks();
    expect(editor.getDocument()).toBe("[doc.txt](assets/doc.txt)");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
