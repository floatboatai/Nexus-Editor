import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-03-F01: 插件 handlers 的 keydown 钩子可消费事件并影响文档", () => {
  it("步骤1-3: keydown 消费、defaultPrevented、文档含 HOOK", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "keydown-hook",
          handlers: {
            keydown: (_event, ctx) => {
              ctx.insertMarkdown("HOOK");
              return true;
            },
          },
        },
      ],
    });

    // 步骤1: 派发 keydown 事件至 .cm-content
    const content = container.querySelector(".cm-content") as HTMLElement;
    const evt = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    content.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    // 步骤2: 文档含 HOOK
    expect(editor.getDocument()).toContain("HOOK");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
