import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

describe("FP-06-01-D01: coords 数据契约：字段存在且为 null 或 {left,top,bottom} 三数值", () => {
  it("步骤1-3: open 与 closed 载荷均含 coords 键，类型契约成立", () => {
    // 打开态
    editor.setDocument("/he");
    editor.setSelection(3);
    const open = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect("coords" in open).toBe(true);
    if (open.coords !== null) {
      expect(typeof open.coords.left).toBe("number");
      expect(typeof open.coords.top).toBe("number");
      expect(typeof open.coords.bottom).toBe("number");
      expect(Number.isNaN(open.coords.left)).toBe(false);
    }

    // 关闭态（光标移出）
    editor.setDocument("plain text");
    editor.setSelection(10); // "plain text" 10 字符
    const closed = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect("coords" in closed).toBe(true);
    expect(closed.coords).toBeNull();
  });
});
