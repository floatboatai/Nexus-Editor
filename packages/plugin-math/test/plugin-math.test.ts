import { createEditor } from "@floatboat/nexus-core";
import type { Parent, Root } from "mdast";
import { describe, expect, it } from "vitest";

import { createMathPlugin } from "../src/index";

function childTypes(ast: Root): string[] {
  const paragraph = ast.children[0] as Parent;
  return paragraph.children.map((node) => node.type);
}

function requireAst(ast: Root | null): Root {
  if (!ast) throw new Error("Expected change callback to receive an AST");
  return ast;
}

describe("@floatboat/nexus-plugin-math public AST", () => {
  it("exposes inlineMath nodes through editor.getAst()", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Before $x+y$ after",
      plugins: [createMathPlugin()]
    });

    expect(childTypes(editor.getAst())).toEqual(["text", "inlineMath", "text"]);
    editor.destroy();
  });

  it("emits inlineMath nodes through the change callback", () => {
    const container = document.createElement("div");
    let changedAst: Root | null = null;
    const editor = createEditor({
      container,
      plugins: [createMathPlugin()],
      onChange(_markdown, ast) {
        changedAst = ast;
      }
    });

    editor.setDocument("Before $x+y$ after");

    expect(childTypes(requireAst(changedAst))).toEqual(["text", "inlineMath", "text"]);
    editor.destroy();
  });

  it("uses math node values instead of raw delimiters in the table of contents", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Energy $E=mc^2$",
      plugins: [createMathPlugin()]
    });

    expect(editor.getTableOfContents()).toEqual([
      { level: 1, text: "Energy E=mc^2", from: 0, to: 17 }
    ]);
    editor.destroy();
  });
});
