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

describe("FP-06-02-F01: 连续键入 /h→/he→/hea 回调序列与末次载荷", () => {
  it("步骤1-4: 每步末次载荷 query 依次为 h/he/hea，末次匹配 Heading", () => {
    const lastQuery = () => handler.mock.calls.at(-1)[0].query;

    editor.setDocument("/h");
    editor.setSelection(2);
    expect(lastQuery()).toBe("h");

    editor.setDocument("/he");
    editor.setSelection(3);
    expect(lastQuery()).toBe("he");

    editor.setDocument("/hea");
    editor.setSelection(4);
    expect(lastQuery()).toBe("hea");

    // 回调序列覆盖逐步键入（doc 替换 + 选区移动均 emit）
    const queries = handler.mock.calls.map((c: any[]) => c[0].query);
    expect(queries).toContain("h");
    expect(queries).toContain("he");
    expect(queries).toContain("hea");

    const last = handler.mock.calls.at(-1)[0];
    expect(last.isOpen).toBe(true);
    expect(last.commands.map((c: { id: string }) => c.id)).toEqual(["heading"]);
  });
});
