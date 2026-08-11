import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
import { createSlashMenuUI } from "@floatboat/nexus-plugin-slash";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
document.body.appendChild(container);
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});

describe("FP-06-03-E02: 菜单节点随 destroy 清理：解除订阅 + 移除 DOM", () => {
  it("步骤1-3: destroy 后节点移除、再触发无副作用", () => {
    const ui = createSlashMenuUI(editor);
    const menu = ui.element;
    expect(document.body.contains(menu)).toBe(true);

    ui.destroy();

    expect(document.body.contains(menu)).toBe(false);
    expect(document.querySelector(".nexus-slash-menu")).toBeNull();
    // 销毁后再触发不抛错、不复活
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(document.querySelector(".nexus-slash-menu")).toBeNull();
  });
});
