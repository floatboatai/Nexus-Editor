import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

const { mermaidMock } = vi.hoisted(() => ({
  mermaidMock: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
    parse: vi.fn().mockResolvedValue({ diagramType: "flowchart" }),
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
    initialValue: "```mermaid\nflowchart LR\nA-->B\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-E01: mermaid 初始化强制 securityLevel strict", () => {
  it("步骤1-3: 渲染 mermaid 块时 initialize 携带 securityLevel=strict", async () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    await vi.waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled());

    expect(mermaidMock.initialize.mock.calls[0][0]).toMatchObject({
      securityLevel: "strict",
    });
    editor.destroy();
  });
});
