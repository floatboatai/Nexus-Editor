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

describe("FP-06-01-N01: 斜杠触发坐标+选区状态计算并 emit，core 不创建任何菜单 DOM", () => {
  it("步骤1-4: 打开菜单且容器零 UI 渲染", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    const last = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(handler).toHaveBeenCalled();
    expect(last.isOpen).toBe(true);
    expect(last.from).toBe(0);
    expect(last.to).toBe(1);
    expect(last.query).toBe("");
    // 零 UI 渲染：无 slash 菜单 DOM 注入（core 仅 emit 事件）
    expect(document.querySelector(".nexus-slash-menu")).toBeNull();
  });
});
