import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const slashHandler = vi.fn();
const selectionHandler = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", slashHandler);
editor.on("selectionChange", selectionHandler);

describe("FP-06-01-N04: 选区状态与 slash 状态一致，位置信息互相对应", () => {
  it("步骤1-4: selectionChange 与 slashMenuChange 的末端位置一致", () => {
    editor.setDocument("hi /he");
    editor.setSelection(6);

    expect(selectionHandler.mock.calls.at(-1)[0]).toMatchObject({ anchor: 6, head: 6 });
    expect(slashHandler.mock.calls.at(-1)[0]).toMatchObject({ from: 3, to: 6, query: "he" });
  });
});
