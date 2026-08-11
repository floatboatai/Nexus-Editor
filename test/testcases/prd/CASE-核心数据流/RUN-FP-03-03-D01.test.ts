import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
    livePreview: true,
    parseDelayMs: 0,
    plugins: [createGfmPreset()],
  });
  return { container, editor };
}

describe("FP-03-03-D01: 表格节点→block Replace Widget（GFM 表格折叠为可编辑表格）", () => {
  it("步骤1-5: 表格渲染、表头、nexus-cell、源码折叠、AST table", () => {
    const { container, editor } = setup();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // 表头行含 1 个 row-grip th + N 个 cell th，需用 th.nexus-cell 精确断言列数
    const ths = container.querySelectorAll("th.nexus-cell");
    expect(ths.length).toBe(2);
    expect(Array.from(ths).map((t) => t.textContent)).toEqual(["A", "B"]);
    const cells = container.querySelectorAll("td.nexus-cell");
    expect(cells.length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("| --- | --- |");
    const ast = editor.getAst();
    const hasTable = ast.children.some((c) => c.type === "table");
    expect(hasTable).toBe(true);
    editor.destroy();
  });
});
