import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FP-01-07-E02: 未配置 onAssetUpload 时 drop 不插入文档（CM6 内建 file drop 必然 preventDefault）", () => {
  it("步骤1-3: uploadAsset=null、drop 被 CM6 内建消费、文档不变", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container });

    // 步骤1: uploadAsset 返回 null
    const file = new File(["x"], "c.png", { type: "image/png" });
    await expect(editor.uploadAsset(file)).resolves.toBeNull();
    // 步骤2: drop 带 dataTransfer.files 时 CM6 内建 handlers.drop 返回 true 触发
    // preventDefault（@codemirror/view index.js L5041-L5063：files.length>0 即 return true），
    // 与 Nexus 是否配置 onAssetUpload 无关 —— 这是 CM6 固有行为。
    // 注意：File 内容须为二进制控制字符，使 CM6 内建 FileReader 检测
    // /[\x00-\x08\x0e-\x1f]{2}/ 命中而跳过文本插入（jsdom 中文本 File 会被读作文本插入）
    const binaryFile = new File([new Uint8Array([0x00, 0x01])], "c.png", { type: "image/png" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [binaryFile] } });
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // 步骤3: 文档无插入（二进制内容被 CM6 检测跳过）
    await flushMicrotasks();
    expect(editor.getDocument()).toBe("");
    editor.destroy();

    container.remove();
  });
});
