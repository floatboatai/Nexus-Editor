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
    initialValue: "old content",
    parseDelayMs: 0,
    onChange,
  });
  return { onChange, editor };
}

describe("FP-03-04-E01: silent setDocument 不触发 onChange 但 getDocument/getAst 保持同步", () => {
  it("步骤1-4: silent 更新不触发、AST 同步、后续正常变更恢复触发", () => {
    const { onChange, editor } = setup();
    editor.setDocument("# New", { silent: true });
    expect(editor.getDocument()).toBe("# New");
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getAst().children[0]?.type).toBe("heading");

    editor.setDocument("x");
    expect(onChange).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});
