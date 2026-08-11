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

// 触发前 body 子节点快照（模块级，稳定）
const beforeBodyChildren = document.body.children.length;

describe("FP-06-01-N03: core 零 UI 渲染：slash 状态变化不改变编辑器容器与 body 的 DOM", () => {
  it("步骤1-4: 打开菜单后无菜单 DOM 注入、body 结构不变", () => {
    editor.setDocument("/he");
    editor.setSelection(3);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.at(-1)[0].isOpen).toBe(true);
    // 零 UI 渲染：body 无新增子节点、无任何 slash 菜单元素（core 从不创建该 DOM）
    expect(document.body.children).toHaveLength(beforeBodyChildren);
    expect(document.querySelector(".nexus-slash-menu")).toBeNull();
  });
});
