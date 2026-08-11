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

describe("FP-06-02-D01: commands 载荷与 getSlashCommands() 同源", () => {
  it("步骤1-3: 载荷命令与注册命令 id/title 一致且同引用", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    const last = handler.mock.calls.at(-1)[0];
    const registered = editor.getSlashCommands();
    expect(last.commands.map((c: { id: string }) => c.id)).toEqual(
      registered.map((c: { id: string }) => c.id)
    );
    expect(last.commands.map((c: { title: string }) => c.title)).toEqual(
      registered.map((c: { title: string }) => c.title)
    );
    // 同源：过滤不产生新对象
    expect(last.commands[0]).toBe(registered[0]);
  });
});
