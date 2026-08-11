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

describe("FP-06-01-B02: 多行文档仅当前行行首斜杠触发，跨行 from 偏移正确", () => {
  it("步骤1-3: 第二行行首斜杠触发，from=4（全文档绝对偏移）", () => {
    editor.setDocument("foo\n/hea");
    editor.setSelection(8);

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(last).toMatchObject({ isOpen: true, from: 4, to: 8, query: "hea" });
  });
});
