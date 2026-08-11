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

describe("FP-03-02-F02: 防抖窗口内再次编辑会重置计时器（真正防抖语义）", () => {
  it("步骤1-4: 60ms 处再编辑重置计时，从新编辑起算 100ms", () => {
    const { docs, editor } = setup();
    editor.setDocument("first");
    vi.advanceTimersByTime(60);
    expect(docs).toEqual([]);

    editor.setDocument("second");
    vi.advanceTimersByTime(40);
    expect(docs).toEqual([]);

    vi.advanceTimersByTime(60);
    expect(docs).toEqual(["second"]);
    editor.destroy();
  });
});
