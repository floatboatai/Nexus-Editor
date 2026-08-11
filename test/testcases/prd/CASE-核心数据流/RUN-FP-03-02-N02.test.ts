import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  return { docs, editor };
}

describe("FP-03-02-N02: 防抖窗口结束后仅触发一次且参数为最新文档", () => {
  it("步骤1-4: 连续两次 setDocument 后仅触发 1 次，参数为最新文档", () => {
    const { docs, editor } = setup();
    editor.setDocument("first");
    editor.setDocument("second");
    expect(editor.getDocument()).toBe("second");
    expect(docs).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(docs).toEqual(["second"]);
    expect(editor.getDocument()).toBe("second");
    editor.destroy();
  });
});
