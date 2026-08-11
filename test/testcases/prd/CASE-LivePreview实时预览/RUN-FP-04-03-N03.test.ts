import { describe, expect, it } from "vitest";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor } from "@floatboat/nexus-core";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("FP-04-03-N03: 多个 React widget 节点独立挂载且内容互不干扰", () => {
  it("步骤1-3: 两个节点独立、各带自身数据", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **one** and **two**\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: {
        renderers: {
          strong: (ctx) => {
            const host = document.createElement("span");
            host.setAttribute("data-testid", "react-widget");
            host.setAttribute("data-which", ctx.text);
            createRoot(host).render(
              createPortal(
                React.createElement("span", { "data-testid": "react-widget-inner" }, ctx.text),
                host
              )
            );
            return host;
          },
        },
      },
    });
    editor.setSelection(editor.getDocument().length);
    await flush();

    // 步骤1: 两个节点均挂载
    const widgets = container.querySelectorAll('[data-testid="react-widget"]');
    expect(widgets.length).toBe(2);
    // 步骤2: 各自内容
    expect(container.querySelector('[data-which="one"]')).not.toBeNull();
    expect(container.querySelector('[data-which="two"]')).not.toBeNull();
    // 步骤3: 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
