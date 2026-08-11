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
  return { container, docs, editor };
}

describe("FP-03-02-E01: destroy() 取消未触发的防抖任务", () => {
  it("步骤1-4: destroy 清除排队任务，runAllTimers 不触发 onChange，DOM 卸载", () => {
    const { container, docs, editor } = setup();
    editor.setDocument("queued");
    editor.destroy();
    vi.runAllTimers();
    expect(docs).toEqual([]);
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
