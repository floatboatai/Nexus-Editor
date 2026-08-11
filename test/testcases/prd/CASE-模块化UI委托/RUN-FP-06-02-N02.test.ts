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

describe("FP-06-02-N02: off 取消订阅后不再回调", () => {
  it("步骤1-3: off 后触发不再回调", () => {
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(handler.mock.calls.length).toBeGreaterThan(0);
    const before = handler.mock.calls.length;

    editor.off("slashMenuChange", handler);
    editor.setDocument("/hea");
    editor.setSelection(4);

    expect(handler.mock.calls.length).toBe(before);
  });
});
