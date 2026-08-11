import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-E03: onAssetUpload 抛异常时拖拽不插入且不向外抛错", () => {
  it("步骤1-3: 拖拽路径无未捕获异常、文档不变、destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: async () => {
        throw new Error("upload-failed");
      },
    });

    // 步骤1: drop 路径内部 catch，不向外抛
    const file = new File(["x"], "d.png", { type: "image/png" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    expect(() => content.dispatchEvent(event)).not.toThrow();
    await flushMicrotasks();
    // 步骤2: 文档不变
    expect(editor.getDocument()).toBe("");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
