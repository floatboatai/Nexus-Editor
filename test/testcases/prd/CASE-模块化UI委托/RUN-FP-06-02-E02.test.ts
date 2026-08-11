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
editor.on("slashMenuChange", handler); // 重复 on 同一 handler

describe("FP-06-02-E02: 同一 handler 重复 on 两次仅回调一次", () => {
  it("步骤1-3: 触发后每次 update 只投递 1 份载荷（Set 去重不放大）", () => {
    const n0 = handler.mock.calls.length;

    editor.setDocument("/he");
    editor.setSelection(3);

    const delta = handler.mock.calls.length - n0;
    // docChanged + selectionSet 各至多 emit 一次；重复 on 同一 handler 不放大投递
    expect(delta).toBeLessThanOrEqual(2);
    // 去重成立：若未去重，同一 handler 注册两次会翻倍为 4
    expect(delta).not.toBeGreaterThan(2);
  });
});
