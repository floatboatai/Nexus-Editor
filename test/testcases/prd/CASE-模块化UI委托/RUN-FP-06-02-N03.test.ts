import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler1 = vi.fn();
const handler2 = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
  { id: "table", title: "Table", keywords: ["grid"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler1);
editor.on("slashMenuChange", handler2);

describe("FP-06-02-N03: 多订阅者广播：两个 handler 均收到同一 state", () => {
  it("步骤1-3: 两个 handler 都收到且载荷相同", () => {
    editor.setDocument("/t");
    editor.setSelection(2);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
    const s1 = handler1.mock.calls.at(-1)[0];
    const s2 = handler2.mock.calls.at(-1)[0];
    expect(s1).toEqual(s2);
    expect(s1.isOpen).toBe(true);
    expect(s1.query).toBe("t");
  });
});
