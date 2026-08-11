import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
  { id: "table", title: "Table", keywords: ["grid"] },
  { id: "bold", title: "Bold", keywords: ["strong"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

describe("FP-06-02-N01: on 订阅后输入触发回调，载荷为完整 SlashMenuState（六字段齐备）", () => {
  it("步骤1-3: 六字段均存在且类型正确", () => {
    editor.setDocument("/");
    editor.setSelection(1);

    expect(handler).toHaveBeenCalled();
    const last = handler.mock.calls.at(-1)[0];
    for (const key of ["isOpen", "from", "to", "query", "commands", "coords"]) {
      expect(key in last).toBe(true);
    }
    expect(last.isOpen).toBe(true);
    expect(typeof last.from).toBe("number");
    expect(typeof last.to).toBe("number");
    expect(typeof last.query).toBe("string");
    expect(Array.isArray(last.commands)).toBe(true);
    expect(last.coords).toBeNull(); // jsdom 无布局
  });
});
