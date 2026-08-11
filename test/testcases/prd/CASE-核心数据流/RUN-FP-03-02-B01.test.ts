import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0, // 0ms = 同步分支
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  return { docs, editor };
}

describe("FP-03-02-B01: parseDelayMs=0 时不防抖、同步触发 onChange", () => {
  it("步骤1-3: 每次 setDocument 同步触发，docs 逐次追加", () => {
    const { docs, editor } = setup();
    editor.setDocument("x");
    expect(docs).toEqual(["x"]);
    editor.setDocument("y");
    editor.setDocument("z");
    expect(docs).toEqual(["x", "y", "z"]);
    editor.destroy();
  });
});
