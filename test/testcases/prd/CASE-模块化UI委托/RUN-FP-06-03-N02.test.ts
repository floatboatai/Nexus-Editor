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
  { id: "table", title: "Table", keywords: ["grid"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});

describe("FP-06-03-N02: 宿主渲染：reposition 使用 coords 定位（left/bottom+offset）", () => {
  it("步骤1-4: jsdom 下菜单可见、left/top 无 NaN、item 渲染", () => {
    const ui = createSlashMenuUI(editor, { offset: 4 });
    const menu = ui.element;

    editor.setDocument("/");
    editor.setSelection(1);

    // 菜单可见
    expect(menu.style.display).toBe("block");
    // coords=null 时位置保持默认，不产生 NaNpx
    expect(menu.style.left).not.toContain("NaN");
    expect(menu.style.top).not.toContain("NaN");
    // 命令渲染为 item
    expect(menu.querySelectorAll(".nexus-slash-menu__item").length).toBe(2);
    ui.destroy();
  });
});
