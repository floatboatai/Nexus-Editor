import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Hello",
    parseDelayMs: 0,
  });
  return { editor };
}

describe("FP-03-01-E01: 越界偏移 replaceRange 抛出 RangeError", () => {
  it("步骤1-2: 越界 replaceRange 抛 RangeError 且状态未被污染", () => {
    const { editor } = setup();
    expect(() => editor.replaceRange(100, 200, "x")).toThrow(RangeError);
    expect(editor.getDocument()).toBe("Hello");
    editor.destroy();
  });

  it("步骤3: 合法范围 replaceRange 恢复正常工作", () => {
    const { editor } = setup();
    editor.replaceRange(0, 5, "Hi");
    expect(editor.getDocument()).toBe("Hi");
    editor.destroy();
  });
});
