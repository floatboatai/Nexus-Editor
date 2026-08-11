import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const { mermaidMock } = vi.hoisted(() => ({
  mermaidMock: {
    initialize: vi.fn(),
    render: vi.fn(),
    parse: vi.fn().mockRejectedValue(new Error("Lexical error in line 1")),
  },
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "```mermaid\nflowchart LR\nA--B\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-E02: mermaid 解析失败时显示错误信息、不注入可执行内容", () => {
  it("步骤1-3: 显示 Mermaid error 文本、body 无孤儿节点、无脚本", async () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    await vi.waitFor(() =>
      expect(container.querySelector(".nexus-mermaid")?.textContent).toContain("Mermaid error")
    );

    const text = container.querySelector(".nexus-mermaid")?.textContent ?? "";
    expect(text).toContain("Lexical error");
    expect(document.querySelector('svg[id^="nexus-mmd"]')).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    editor.destroy();
  });
});
