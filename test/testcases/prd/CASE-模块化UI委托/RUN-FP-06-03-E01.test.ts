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

describe("FP-06-03-E01: jsdom 无布局 coords=null：菜单仍可见但位置保持默认", () => {
  it("步骤1-4: 触发后菜单可见、left/top 保持默认空值", () => {
    const ui = createSlashMenuUI(editor);
    const menu = ui.element;

    expect(menu.style.display).toBe("none");
    editor.setDocument("/he");
    editor.setSelection(3);

    expect(menu.style.display).toBe("block");
    expect(menu.style.left).toBe("");
    expect(menu.style.top).toBe("");
    ui.destroy();
  });
});
