import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
  { id: "table", title: "Table", keywords: ["grid"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

function last(): any {
  return handler.mock.calls[handler.mock.calls.length - 1][0];
}

describe("FP-06-01-F01: 菜单状态随光标生命周期开/关", () => {
  it("步骤1-4: 打开→移出关闭→重新打开，回调序列含 open/closed", () => {
    // 步骤1: 打开
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(last().isOpen).toBe(true);
    expect(last().query).toBe("he");

    // 步骤2: 移出 slash 触发区 → 关闭（"plain text" 长度 10，用例文档 11 为笔误）
    editor.setDocument("plain text");
    editor.setSelection(10);
    expect(last().isOpen).toBe(false);
    expect(last().commands.length).toBe(0);

    // 步骤3: 重新输入斜杠 → 重新打开
    editor.setDocument("/h");
    editor.setSelection(2);
    expect(last().isOpen).toBe(true);
    expect(last().query).toBe("h");
    expect(last().from).toBe(0);
    expect(last().to).toBe(2);

    // 步骤4: 回调序列覆盖 open 与 closed
    expect(handler.mock.calls.some((c: any[]) => c[0].isOpen === true)).toBe(true);
    expect(handler.mock.calls.some((c: any[]) => c[0].isOpen === false)).toBe(true);
  });
});
