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

describe("FP-06-02-E01: off 从未注册的 handler 幂等安全（不抛错）", () => {
  it("步骤1-2: off 未注册 handler 不抛错", () => {
    expect(() => editor.off("slashMenuChange", handler)).not.toThrow();
    // 未注册 handler 即使调用 off 后也不会收到回调
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(handler).not.toHaveBeenCalled();
  });
});
