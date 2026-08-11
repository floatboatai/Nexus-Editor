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

describe("FP-06-03-B01: 自定义容器：菜单挂载到 ShadowRoot", () => {
  it("步骤1-4: 菜单进入 shadowRoot、body 无泄漏", () => {
    const host = document.createElement("div");
    host.id = "shadow-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const ui = createSlashMenuUI(editor, { container: shadow });

    const menu = shadow.querySelector(".nexus-slash-menu");
    expect(menu).not.toBeNull();
    expect(host.shadowRoot?.contains(menu)).toBe(true);
    expect(document.body.contains(menu)).toBe(false);
    expect((menu as HTMLElement).style.position).toBe("fixed");
    ui.destroy();
    host.remove();
  });
});
