import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-E01: eqKey 相同时 widget DOM 复用（mountCount 不增长）", () => {
  it("步骤1-2: 光标移动但不离结构时组件不重复挂载", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold**\n\nend";
    let mountCount = 0;
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: {
        renderers: {
          strong: (ctx) => {
            mountCount++;
            const host = document.createElement("span");
            host.setAttribute("data-testid", "react-mount");
            host.setAttribute("data-mounts", String(mountCount));
            createRoot(host).render(
              createPortal(
                React.createElement("span", { "data-testid": "react-mount-inner" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    // 步骤1: 初始挂载一次
    editor.setSelection(0);
    await flush();
    expect(container.querySelector('[data-testid="react-mount"]')?.getAttribute("data-mounts")).toBe("1");
    // 步骤2: 光标在 strong 结构外移动（0 → 2），eqKey 不变 → DOM 复用，不重新挂载
    editor.setSelection(2);
    await flush();
    expect(container.querySelector('[data-testid="react-mount"]')?.getAttribute("data-mounts")).toBe("1");
    // 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
