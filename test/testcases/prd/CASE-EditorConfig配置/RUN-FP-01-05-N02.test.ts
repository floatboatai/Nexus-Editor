import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-05-N02: onChange 第二参数为最新 AST", () => {
  it("步骤1-3: 首次 heading、二次 paragraph、destroy", () => {
    let lastAst: Root | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onChange: (_doc, ast) => {
        lastAst = ast;
      },
    });

    // 步骤1: setDocument("# Hello") → heading
    editor.setDocument("# Hello");
    expect((lastAst as Root).children[0]?.type).toBe("heading");
    // 步骤2: setDocument("plain text") → paragraph
    editor.setDocument("plain text");
    expect((lastAst as Root).children[0]?.type).toBe("paragraph");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
