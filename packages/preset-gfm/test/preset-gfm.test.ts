import { createEditor } from "@floatboat/nexus-core";
import type { List, ListItem } from "mdast";
import { describe, expect, it } from "vitest";
import { createGfmPreset } from "../src/index";

describe("@floatboat/nexus-preset-gfm", () => {
  it("adds table parsing support through the core plugin system", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| a | b |\n| - | - |\n| 1 | 2 |",
      plugins: [createGfmPreset()],
    });

    expect(editor.getAst().children[0]?.type).toBe("table");
    editor.destroy();
  });

  it("adds task list parsing support through the core plugin system", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- [x] done",
      plugins: [createGfmPreset()],
    });

    const firstChild = editor.getAst().children[0] as List | undefined;
    const firstItem = firstChild?.children[0] as ListItem | undefined;

    expect(firstChild?.type).toBe("list");
    expect(firstItem?.checked).toBe(true);
    editor.destroy();
  });
});
