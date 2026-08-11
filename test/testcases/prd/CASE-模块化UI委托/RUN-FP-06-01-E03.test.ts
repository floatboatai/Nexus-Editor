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

describe("FP-06-01-E03: query 含空白字符时菜单关闭", () => {
  it("步骤1-3: query 含空格 → isOpen=false 且 commands 为空", () => {
    editor.setDocument("/he a");
    editor.setSelection(5);

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(last.isOpen).toBe(false);
    expect(last.commands).toHaveLength(0);
  });
});
