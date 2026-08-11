import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-D01: React portal 节点挂载于 CM6 行/内容层级内且与默认渲染共存", () => {
  it("步骤1-4: 层级正确、混合渲染、文档不变", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold** and *italic*\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: {
        renderers: {
          strong: (ctx) => {
            const host = document.createElement("span");
            createRoot(host).render(
              createPortal(
                React.createElement("span", { "data-testid": "portal-node" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    // 光标在末尾 → strong 用 React 渲染，emphasis 用默认 mark 折叠
    editor.setSelection(editor.getDocument().length);
    await flush();

    // 步骤1: portal 节点挂载
    const node = container.querySelector('[data-testid="portal-node"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toBe("bold");
    // 步骤2: 挂载层级——在 .cm-line 与 .cm-content 内
    expect(node?.closest(".cm-content")).not.toBeNull();
    expect(node?.closest(".cm-line")).not.toBeNull();
    // 步骤3: 默认渲染（emphasis）仍生效
    const text = container.textContent ?? "";
    expect(text).toContain("italic");
    expect(text).not.toContain("**bold**");
    // 步骤4: 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
