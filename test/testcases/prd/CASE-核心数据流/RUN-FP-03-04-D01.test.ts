import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "# Initial",
    parseDelayMs: 0,
    onChange,
  });
  return { onChange, editor };
}

describe("FP-03-04-D01: 初始创建不触发 onChange，首次变更才触发", () => {
  it("步骤1-4: 创建 0 次调用、初始 AST 就绪、变更后恰好 1 次", () => {
    const { onChange, editor } = setup();
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getAst().children[0]?.type).toBe("heading");

    editor.setDocument("# Changed");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("# Changed");
    editor.destroy();
  });
});
