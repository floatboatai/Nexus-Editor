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

describe("FP-06-03-N01: 宿主渲染：createSlashMenuUI 挂载菜单到 body（position: fixed）", () => {
  it("步骤1-4: 菜单挂载 body、class nexus-slash-menu、position fixed", () => {
    const ui = createSlashMenuUI(editor);

    const menu = document.querySelector(".nexus-slash-menu");
    expect(menu).not.toBeNull();
    expect(document.body.contains(menu)).toBe(true);
    expect((menu as HTMLElement).style.position).toBe("fixed");
    expect(ui.element).toBe(menu);
    expect(menu?.getAttribute("role")).toBe("listbox");
    ui.destroy();
  });
});
