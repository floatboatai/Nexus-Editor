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

describe("FP-06-01-E02: 行内 URL/路径中的斜杠不触发 slash 匹配", () => {
  it("步骤1-2: http:// 内斜杠不触发，末次载荷为关闭态", () => {
    editor.setDocument("http://example.com");
    editor.setSelection(18); // "http://example.com" 18 字符，用例文档 19 为笔误

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(last).toEqual({ isOpen: false, from: null, to: null, query: "", commands: [], coords: null });
  });
});
