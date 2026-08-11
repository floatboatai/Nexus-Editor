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
    initialValue: "| 列1 | 列2 |\n| --- | --- |\n| [外部](https://example.com) | 文本 |",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-02-N01: 表格内链接渲染为 a[target=_blank] 且 rel=noopener noreferrer", () => {
  it("步骤1-5: 表格内 a 存在、rel/target 正确、文本正确", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const a = container.querySelector('a[href="https://example.com"]');
    expect(a).not.toBeNull();
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.textContent).toBe("外部");
    editor.destroy();
  });
});
