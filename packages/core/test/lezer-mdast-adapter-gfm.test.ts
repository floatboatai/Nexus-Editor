import { describe, expect, it } from "vitest";
import type {
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Strong,
  Table,
} from "mdast";

import { createEditor } from "../src/index";

/** Parse a markdown string through the editor's Lezer→mdast adapter. */
function astFor(markdown: string): Root {
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: markdown });
  const ast = editor.getAst();
  editor.destroy();
  return ast;
}

describe("lezer → mdast GFM fidelity", () => {
  describe("task lists", () => {
    it("emits the item text as a paragraph child", () => {
      const list = astFor("- [x] done").children[0] as List;
      const item = list.children[0] as ListItem;
      expect(item.checked).toBe(true);
      const para = item.children[0] as Paragraph;
      expect(para.type).toBe("paragraph");
      expect(para.children).toMatchObject([{ type: "text", value: "done" }]);
    });

    it("sets checked=false for an open checkbox and keeps its text", () => {
      const list = astFor("- [ ] todo").children[0] as List;
      const item = list.children[0] as ListItem;
      expect(item.checked).toBe(false);
      expect(item.children).toMatchObject([
        { type: "paragraph", children: [{ type: "text", value: "todo" }] },
      ]);
    });

    it("preserves inline marks inside a task item", () => {
      const list = astFor("- [x] **done** with `code`").children[0] as List;
      const para = (list.children[0] as ListItem).children[0] as Paragraph;
      const strong = para.children[0] as Strong;
      const inlineCode = para.children[2] as InlineCode;
      expect(strong.type).toBe("strong");
      expect(strong.children).toMatchObject([{ type: "text", value: "done" }]);
      expect(para.children[1]).toMatchObject({ type: "text", value: " with " });
      expect(inlineCode.type).toBe("inlineCode");
      expect(inlineCode.value).toBe("code");
    });

    it("leaves an empty task item without a paragraph", () => {
      const list = astFor("- [x] ").children[0] as List;
      const item = list.children[0] as ListItem;
      expect(item.checked).toBe(true);
      expect(item.children).toEqual([]);
    });
  });

  describe("GFM autolinks", () => {
    it("emits a single flat link for an angle-bracket autolink", () => {
      const para = astFor("<https://example.com>").children[0] as Paragraph;
      const link = para.children[0] as Link;
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
      expect(link.children).toHaveLength(1);
      expect(link.children[0]).toMatchObject({
        type: "text",
        value: "https://example.com",
      });
    });

    it("emits a single flat link for a bare URL", () => {
      const para = astFor("see https://example.com now").children[0] as Paragraph;
      const link = para.children.find((child) => child.type === "link") as Link;
      expect(link.url).toBe("https://example.com");
      expect(link.children).toHaveLength(1);
      expect(link.children[0]).toMatchObject({
        type: "text",
        value: "https://example.com",
      });
    });
  });

  describe("table alignment", () => {
    it("extracts left / center / right / default alignment", () => {
      const table = astFor(
        "| a | b | c | d |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |",
      ).children[0] as Table;
      expect(table.align).toEqual(["left", "center", "right", null]);
    });

    it("defaults to null alignment when no colons are present", () => {
      const table = astFor("| a | b |\n| --- | --- |\n| 1 | 2 |").children[0] as Table;
      expect(table.align).toEqual([null, null]);
    });
  });
});
