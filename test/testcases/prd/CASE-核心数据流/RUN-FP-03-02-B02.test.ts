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
    // 不传 parseDelayMs：源码默认 `config.parseDelayMs ?? 0`（editor.ts:282）= 同步 emit
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  return { docs, editor };
}

describe("FP-03-02-B02: 未配置 parseDelayMs 时的实际默认行为（同步，与 PRD 100ms 描述存在差异）", () => {
  it("步骤1-2: 默认 0ms 同步触发，docs 等于 ['x']", () => {
    const { docs, editor } = setup();
    editor.setDocument("x");
    expect(docs).toEqual(["x"]);
    editor.destroy();
  });
});
