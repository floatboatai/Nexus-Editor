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

describe("FP-03-02-F01: 连续三次编辑防抖后仅触发一次 onChange", () => {
  it("步骤1-4: v1/v2/v3 合并为一次解析，参数为 v3，且无重复触发", () => {
    const { docs, editor } = setup();
    editor.setDocument("v1");
    editor.setDocument("v2");
    editor.setDocument("v3");
    expect(editor.getDocument()).toBe("v3");
    expect(docs).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(docs).toEqual(["v3"]);
    vi.advanceTimersByTime(1000);
    expect(docs).toEqual(["v3"]);
    editor.destroy();
  });
});
