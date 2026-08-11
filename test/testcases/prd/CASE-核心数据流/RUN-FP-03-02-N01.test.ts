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

describe("FP-03-02-N01: 防抖窗口内（parseDelayMs=100ms）不触发 onChange", () => {
  it("步骤1-2: setDocument 立即更新文档，但窗口内 docs 为空", () => {
    const { docs, editor } = setup();
    editor.setDocument("first");
    expect(editor.getDocument()).toBe("first");
    expect(docs).toEqual([]);
    editor.destroy();
  });

  it("步骤3: 推进 50ms（<100）仍不触发", () => {
    const { docs, editor } = setup();
    editor.setDocument("first");
    vi.advanceTimersByTime(50);
    expect(docs).toEqual([]);
    editor.destroy();
  });

  it("步骤4: 累计 100ms 后触发 1 次，参数为 'first'", () => {
    const { docs, editor } = setup();
    editor.setDocument("first");
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    expect(docs).toEqual(["first"]);
    editor.destroy();
  });
});
