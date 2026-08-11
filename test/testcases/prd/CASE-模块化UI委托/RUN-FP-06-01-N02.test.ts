import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
document.body.appendChild(container);
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

describe("FP-06-01-N02: 状态载荷携带 coords 字段，jsdom 无布局时 null 降级合法", () => {
  it("步骤1-4: coords 键存在、jsdom 下为 null、from/to/query 正确", () => {
    editor.setDocument("/hea");
    editor.setSelection(4);

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect("coords" in last).toBe(true);
    // jsdom 无布局 → coords 合法降级为 null
    expect(last.coords).toBeNull();
    // 行首斜杠 from=0（用例文档 from=1 为笔误，getSlashMatch 返回 lineStart+slashIndex=0）
    expect(last).toMatchObject({ from: 0, to: 4, query: "hea" });
  });
});
