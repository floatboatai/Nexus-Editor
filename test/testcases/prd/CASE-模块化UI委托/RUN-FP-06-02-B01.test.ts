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
  { id: "code", title: "Code", keywords: ["mono"] },
  { id: "quote", title: "Quote", keywords: ["blockquote"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  slashMenuLimit: 3,
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

describe("FP-06-02-B01: slashMenuLimit=3 时命令排名后截断为 3 条", () => {
  it("步骤1-3: commands 长度被限制为 3", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    const last = handler.mock.calls.at(-1)[0];
    expect(last.isOpen).toBe(true);
    expect(last.commands).toHaveLength(3);
    expect(last.commands[0].id).toBe("heading");
    expect(last.commands[2].id).toBe("bold");
  });
});
