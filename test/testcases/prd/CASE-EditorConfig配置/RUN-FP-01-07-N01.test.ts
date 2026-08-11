import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function dispatchDrop(content: HTMLElement, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  content.dispatchEvent(event);
  return event;
}

describe("FP-01-07-N01: 配置 onAssetUpload 钩子后 uploadAsset 上传成功返回 URL", () => {
  it("步骤1-3: uploadAsset 返回 URL、钩子参数、destroy", async () => {
    const uploadHook = vi.fn(async (file: File) => `assets/${file.name}`);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onAssetUpload: uploadHook,
    });

    // 步骤1: uploadAsset 返回 URL
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(editor.uploadAsset(file)).resolves.toBe("assets/a.png");
    // 步骤2: 钩子被调用且参数为同一 File
    expect(uploadHook).toHaveBeenCalledWith(file);
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
