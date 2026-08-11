import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-B01: setDocument 后 React widget 重新挂载为最新内容", () => {
  it("步骤1-3: 初始渲染旧文本、setDocument 后新文本", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "**old**\n\nend",
      livePreview: {
        renderers: {
          strong: (ctx) => {
            const host = document.createElement("span");
            host.setAttribute("data-testid", "react-remount");
            host.setAttribute("data-text", ctx.text);
            createRoot(host).render(
              createPortal(
                React.createElement("span", { "data-testid": "react-remount-inner" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    // 初始光标 0 在 strong 外 → 折叠渲染 "old"
    await flush();
    expect(container.querySelector('[data-testid="react-remount"]')?.getAttribute("data-text")).toBe("old");

    // 步骤2: setDocument 替换文档
    editor.setDocument("**new**\n\nend");
    await flush();
    // 步骤3: widget 重新挂载为 "new"
    expect(container.querySelector('[data-testid="react-remount"]')?.getAttribute("data-text")).toBe("new");
    expect(editor.getDocument()).toBe("**new**\n\nend");

    editor.destroy();
    container.remove();
  });
});
