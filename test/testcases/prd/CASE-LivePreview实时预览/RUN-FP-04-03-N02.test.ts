import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-N02: 渲染上下文携带 nodeType/text/from/to", () => {
  it("步骤1-3: 上下文字段齐全、host 携带结构化 data 属性", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold**\n\nend";
    const captured: any[] = [];
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: {
        renderers: {
          strong: (ctx) => {
            captured.push(ctx);
            const host = document.createElement("span");
            host.setAttribute("data-node-type", ctx.nodeType);
            host.setAttribute("data-from", String(ctx.from));
            host.setAttribute("data-to", String(ctx.to));
            createRoot(host).render(
              createPortal(
                React.createElement("b", { "data-testid": "ctx-bold" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    // 光标在末尾 → strong 折叠，renderer 被调用
    editor.setSelection(editor.getDocument().length);
    await flush();

    // 步骤1: 上下文字段
    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[0].nodeType).toBe("strong");
    expect(captured[0].text).toBe("bold");
    // 步骤2: from/to 偏移正确（source 中 **bold** 范围 [5,13)）
    expect(captured[0].from).toBe(5);
    expect(captured[0].to).toBe(13);
    // 步骤3: host 结构化属性
    const host = container.querySelector('[data-node-type="strong"]');
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-from")).toBe("5");
    expect(host?.getAttribute("data-to")).toBe("13");
    // 渲染上下文文本正确
    expect(container.querySelector('[data-testid="ctx-bold"]')?.textContent).toBe("bold");

    editor.destroy();
    container.remove();
  });
});
