import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
import { createSlashMenuUI, type SlashMenuCommandContext } from "@floatboat/nexus-plugin-slash";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
document.body.appendChild(container);
const runSpy = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"], run: runSpy },
  { id: "table", title: "Table", keywords: ["grid"], run: runSpy },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});

describe("FP-06-03-F01: 打开→选择→关闭 完整生命周期（宿主渲染驱动）", () => {
  it("步骤1-5: 打开显示菜单、选择执行命令并隐藏、移出光标保持关闭", () => {
    const onCommand = vi.fn();
    const ui = createSlashMenuUI(editor, { onCommand });
    const menu = ui.element;

    // 步骤1: 打开
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(menu.style.display).toBe("block");
    expect(menu.querySelectorAll(".nexus-slash-menu__item").length).toBe(1);

    // 步骤2: 选择第一个命令
    const firstItem = menu.querySelector(".nexus-slash-menu__item") as HTMLElement;
    firstItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // 步骤3: onCommand 携带 command 与 trigger
    expect(onCommand).toHaveBeenCalledTimes(1);
    const [cmd, ctx] = onCommand.mock.calls[0] as [typeof commands[0], SlashMenuCommandContext];
    expect(cmd.id).toBe("heading");
    expect(ctx.trigger.query).toBe("he");
    expect(ctx.trigger.from).toBe(0);
    expect(ctx.trigger.to).toBe(3);

    // 步骤4: 选择后菜单隐藏、/query 已从文档移除
    expect(menu.style.display).toBe("none");
    expect(editor.getDocument()).not.toContain("/he");

    // 步骤5: 移出光标保持关闭（无遗留订阅）
    editor.setDocument("plain text");
    editor.setSelection(10);
    expect(menu.style.display).toBe("none");
    ui.destroy();
  });
});
