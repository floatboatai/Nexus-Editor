import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: {
      renderers: {
        link: (ctx) => {
          const a = document.createElement("a");
          a.href = ctx.node.url ?? "#";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = ctx.text;
          return a;
        },
      },
    },
  });
  return { container, editor };
}

describe("FP-05-02-N03: 自定义 link renderer 渲染链接且 rel 携带 noopener noreferrer", () => {
  it("步骤1-4: 宿主渲染器接管、rel 契约正确", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const a = container.querySelector('a[href="https://example.com"]');
    expect(a).not.toBeNull();
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.textContent).toBe("外部");
    editor.destroy();
  });
});
