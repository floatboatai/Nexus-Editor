import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n# Heading",
    livePreview: {
      renderers: {
        heading({ text }: { text: string }) {
          const element = document.createElement("div");
          element.setAttribute("data-heading", "custom");
          element.textContent = text.toUpperCase();
          return element;
        },
      },
    },
    parseDelayMs: 0,
  });
  return { container, editor };
}

describe("FP-03-03-D02: 自定义 renderer 覆盖默认节点装饰（宿主接管渲染）", () => {
  it("步骤1-4: 自定义渲染生效、内置装饰被接管、AST 不变", () => {
    const { container, editor } = setup();
    const custom = container.querySelector("[data-heading='custom']");
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toBe("HEADING");
    expect(container.querySelector("[data-heading-level]")).toBeNull();
    const ast = editor.getAst();
    expect(ast.children[1]?.type).toBe("heading");
    editor.destroy();
  });
});
