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

describe("FP-06-01-B01: 光标位于文档首字符（doc=/）时 from=0/to=1", () => {
  it("步骤1-4: 空 query 打开菜单、from=0、to=1、commands 按注册序 2 条", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(last).toMatchObject({ isOpen: true, from: 0, to: 1, query: "" });
    expect(last.commands).toHaveLength(2);
    expect(last.commands.map((c: { id: string }) => c.id)).toEqual(["heading", "table"]);
  });
});
