import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler = vi.fn();
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [],
});
editor.on("slashMenuChange", handler);

describe("FP-06-01-E01: 未注册任何 slashCommands 时不 emit", () => {
  it("步骤1-2: 文档与选区正常更新但 handler 不被调用", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    expect(handler).not.toHaveBeenCalled();
  });
});
