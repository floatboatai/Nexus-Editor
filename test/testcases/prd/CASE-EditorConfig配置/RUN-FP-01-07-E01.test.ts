import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-E01: onAssetUpload 返回 null 时不插入内容", () => {
  it("步骤1-3: uploadAsset=null、drop 后文档不变、destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: async () => null, // 模拟上传失败/拒绝
    });

    // 步骤1: uploadAsset 返回 null
    const file = new File(["x"], "b.png", { type: "image/png" });
    await expect(editor.uploadAsset(file)).resolves.toBeNull();
    // 步骤2: drop 后文档不被修改（url 为 null 时 continue 跳过）
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(event);
    await flushMicrotasks();
    // 步骤3: 文档为空
    expect(editor.getDocument()).toBe("");
    editor.destroy();

    container.remove();
  });
});
