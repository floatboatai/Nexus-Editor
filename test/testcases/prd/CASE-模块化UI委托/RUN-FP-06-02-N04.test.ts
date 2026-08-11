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

describe("FP-06-02-N04: 关闭状态推送：光标移出后收到 isOpen=false 且 commands 为空", () => {
  it("步骤1-3: 打开后移出，末次载荷为关闭态", () => {
    editor.setDocument("/he");
    editor.setSelection(3);
    const opened = handler.mock.calls.at(-1)[0];
    expect(opened.isOpen).toBe(true);

    editor.setDocument("plain text");
    editor.setSelection(10);

    const closed = handler.mock.calls.at(-1)[0];
    expect(closed.isOpen).toBe(false);
    expect(closed.commands).toHaveLength(0);
    expect(closed.query).toBe("");
    expect(closed.from).toBeNull();
    expect(closed.to).toBeNull();
  });
});
