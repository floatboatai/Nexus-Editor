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
  { id: "bold", title: "Bold", keywords: ["strong"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  slashMenuLimit: 0,
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

describe("FP-06-02-E03: slashMenuLimit=0 时 isOpen=true 且 commands=[]", () => {
  it("步骤1-3: 打开菜单但命令列表为空数组", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    const last = handler.mock.calls.at(-1)[0];
    expect(last.isOpen).toBe(true);
    expect(last.commands).toEqual([]);
  });
});
