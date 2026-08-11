import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-N01: React createPortal 组件桥接到 widget DOM 且折叠生效", () => {
  it("步骤1-4: portal 挂载、折叠文本、文档不变", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold**\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: {
        renderers: {
          strong: (ctx) => {
            // 修正：createPortal 需配合 React root 才触发渲染
            const host = document.createElement("span");
            createRoot(host).render(
              createPortal(
                React.createElement("b", { "data-testid": "react-bold" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    // 光标在末尾行 → strong 折叠为 React 组件
    editor.setSelection(editor.getDocument().length);
    await flush();

    // 步骤1: React 组件挂载
    const bold = container.querySelector('[data-testid="react-bold"]');
    expect(bold).not.toBeNull();
    expect(bold?.textContent).toBe("bold");
    // 步骤2: 桥接到 CM6 widget 容器
    expect(bold?.closest(".cm-content")).not.toBeNull();
    // 步骤3: 折叠生效
    expect(container.textContent ?? "").not.toContain("**");
    // 步骤4: 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
