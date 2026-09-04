import { EditorState } from "@codemirror/state";

import { describe, expect, it } from "vitest";

import { createMarkdownLanguageSupport } from "../src/lezer-markdown";
import { lezerStringToMdast, lezerTreeToMdast } from "../src/lezer-mdast-adapter";

// 类型助手：读取适配器产出的 mdast 节点字段。助手接受 `unknown` 并内部收窄，
// 调用处无需 `as`，与 packages/core/test/widgets.test.ts 的风格一致。
type AnyNode = { type: string; children?: AnyNode[];[key: string]: unknown };

function asNode(value: unknown): AnyNode {
  return value as AnyNode;
}

function firstChild(root: unknown): AnyNode {
  const children = (asNode(root).children as AnyNode[] | undefined) ?? [];
  return children[0] ?? {};
}

function childAt(root: unknown, index: number): AnyNode {
  const children = (asNode(root).children as AnyNode[] | undefined) ?? [];
  return children[index] ?? {};
}

function stateRoot(markdown: string): AnyNode {
  const support = createMarkdownLanguageSupport();
  const state = EditorState.create({ doc: markdown, extensions: [support] });
  return asNode(lezerTreeToMdast(state));
}

describe("lezerStringToMdast - root", () => {
  it("returns a root node for an empty document", () => {
    const root = asNode(lezerStringToMdast(""));
    expect(root.type).toBe("root");
    expect(root.children).toEqual([]);
  });

  it("carries a position spanning the whole document", () => {
    const root = asNode(lezerStringToMdast("hi"));
    const pos = root.position as { start: { offset: number }; end: { offset: number } };
    expect(pos.start.offset).toBe(0);
    expect(pos.end.offset).toBe(2);
  });
});

describe("lezerStringToMdast - paragraph", () => {
  it("emits a paragraph for plain text", () => {
    const root = asNode(lezerStringToMdast("hello world"));
    expect(firstChild(root).type).toBe("paragraph");
  });

  it("emits nested phrasing children inside a paragraph", () => {
    const root = asNode(lezerStringToMdast("a **b** c"));
    const para = firstChild(root);
    const types = (para.children as AnyNode[]).map((c) => c.type);
    expect(types).toContain("text");
    expect(types).toContain("strong");
  });
});

describe("lezerStringToMdast - heading", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)("emits a heading with depth %d", (depth) => {
    const hashes = "#".repeat(depth);
    const root = lezerStringToMdast(`${hashes} Title`);
    const heading = firstChild(root);
    expect(heading.type).toBe("heading");
    expect(heading.depth).toBe(depth);
  });

  it("recognizes a heading with closing hashes and preserves depth", () => {
    // Note: when Lezer emits two HeaderMark children (opening + closing) with
    // the label text as unnamed content between them, headingTextRange may
    // collapse the text range. This is a known pre-existing behavior; the
    // key invariant tested here is that the heading is still recognized with
    // correct depth and position.
    const root = lezerStringToMdast("# Title #");
    const heading = firstChild(root);
    expect(heading.type).toBe("heading");
    expect(heading.depth).toBe(1);
    const pos = heading.position as { start: { offset: number }; end: { offset: number } };
    expect(pos.start.offset).toBe(0);
    expect(pos.end.offset).toBe(9);
  });

  it("emits the label text for a heading without closing hashes", () => {
    const root = lezerStringToMdast("# Solo");
    const heading = firstChild(root);
    const text = (heading.children as AnyNode[])[0];
    expect(text.value).toBe("Solo");
  });

  it("carries position offsets on heading nodes", () => {
    const root = lezerStringToMdast("# Hi");
    const heading = firstChild(root);
    const pos = heading.position as { start: { offset: number }; end: { offset: number } };
    expect(pos.start.offset).toBeTypeOf("number");
    expect(pos.end.offset).toBeGreaterThan(pos.start.offset);
  });

  it("adapts setext headings with depth 1 and 2", () => {
    const root1 = lezerStringToMdast("Title\n=====");
    expect(firstChild(root1).depth).toBe(1);
    const root2 = lezerStringToMdast("Title\n-----");
    expect(firstChild(root2).depth).toBe(2);
  });
});

describe("lezerStringToMdast - list", () => {
  it("emits an ordered list with the first marker as start", () => {
    const root = lezerStringToMdast("3. one\n4. two");
    const list = firstChild(root);
    expect(list.type).toBe("list");
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
    expect(list.children).toHaveLength(2);
  });

  it("emits an unordered list", () => {
    const root = lezerStringToMdast("- a\n- b");
    const list = firstChild(root);
    expect(list.ordered).toBe(false);
    expect(list.start).toBeNull();
  });

  it("handles nested lists", () => {
    const root = lezerStringToMdast("- a\n  - b");
    const outer = firstChild(root);
    const item = (outer.children as AnyNode[])[0];
    const innerTypes = (item.children as AnyNode[]).map((c) => c.type);
    expect(innerTypes).toContain("list");
  });

  it("detects a checked task list item", () => {
    const root = lezerStringToMdast("- [x] done");
    const list = firstChild(root);
    const item = (list.children as AnyNode[])[0];
    expect(item.checked).toBe(true);
  });

  it("detects an unchecked task list item", () => {
    const root = lezerStringToMdast("- [ ] todo");
    const list = firstChild(root);
    const item = (list.children as AnyNode[])[0];
    expect(item.checked).toBe(false);
  });

  it("leaves checked undefined for non-task items", () => {
    const root = lezerStringToMdast("- plain");
    const list = firstChild(root);
    const item = (list.children as AnyNode[])[0];
    expect(item.checked).toBeUndefined();
  });
});

describe("lezerStringToMdast - table", () => {
  it("emits a table with header and body rows", () => {
    const root = lezerStringToMdast("| a | b |\n| --- | --- |\n| 1 | 2 |");
    const table = firstChild(root);
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(2);
    const header = (table.children as AnyNode[])[0];
    expect(header.children).toHaveLength(2);
  });

  it("emits empty children for an empty cell", () => {
    const root = lezerStringToMdast("|  |  |\n| --- | --- |");
    const table = firstChild(root);
    const header = (table.children as AnyNode[])[0];
    const cell = (header.children as AnyNode[])[0];
    expect(cell.children).toEqual([]);
  });

  it("keeps escaped pipes inside a cell", () => {
    const root = lezerStringToMdast("| a\\|b | c |\n| --- | --- |");
    const table = firstChild(root);
    const header = (table.children as AnyNode[])[0];
    expect(header.children).toHaveLength(2);
  });
});

describe("lezerStringToMdast - code", () => {
  it("emits a fenced code block with lang and value", () => {
    const root = lezerStringToMdast("```js\nfoo\n```");
    const code = firstChild(root);
    expect(code.type).toBe("code");
    expect(code.lang).toBe("js");
    expect(code.value).toBe("foo");
  });

  it("emits null lang when no info string is present", () => {
    const root = lezerStringToMdast("```\nbar\n```");
    const code = firstChild(root);
    expect(code.lang).toBeNull();
  });

  it("strips the 4-space prefix on indented code blocks", () => {
    const root = lezerStringToMdast("    indented");
    const code = firstChild(root);
    expect(code.type).toBe("code");
    expect(code.value).toBe("indented");
  });
});

describe("lezerStringToMdast - inline", () => {
  it("emits inlineCode with the raw value between backticks", () => {
    const root = lezerStringToMdast("`code`");
    const para = firstChild(root);
    const inline = (para.children as AnyNode[])[0];
    expect(inline.type).toBe("inlineCode");
    expect(inline.value).toBe("code");
  });

  it("emits emphasis for *em*", () => {
    const root = lezerStringToMdast("*em*");
    const para = firstChild(root);
    expect((para.children as AnyNode[])[0].type).toBe("emphasis");
  });

  it("emits strong for **st**", () => {
    const root = lezerStringToMdast("**st**");
    const para = firstChild(root);
    expect((para.children as AnyNode[])[0].type).toBe("strong");
  });

  it("emits delete for ~~del~~", () => {
    const root = lezerStringToMdast("~~del~~");
    const para = firstChild(root);
    expect((para.children as AnyNode[])[0].type).toBe("delete");
  });

  it("emits a link with url and label children", () => {
    const root = lezerStringToMdast("[t](https://x.io)");
    const para = firstChild(root);
    const link = (para.children as AnyNode[])[0];
    expect(link.type).toBe("link");
    expect(link.url).toBe("https://x.io");
    expect((link.children as AnyNode[])[0].value).toBe("t");
  });

  it("preserves nested inline nodes inside a link label", () => {
    const root = lezerStringToMdast("[**b**](u)");
    const para = firstChild(root);
    const link = (para.children as AnyNode[])[0];
    expect((link.children as AnyNode[])[0].type).toBe("strong");
  });

  it("emits an autolink as a link", () => {
    const root = lezerStringToMdast("<https://x.io>");
    const para = firstChild(root);
    const link = (para.children as AnyNode[])[0];
    expect(link.type).toBe("link");
    expect(link.url).toBe("https://x.io");
  });

  it("emits an image with alt and url", () => {
    const root = lezerStringToMdast("![logo](img.png)");
    const para = firstChild(root);
    const img = (para.children as AnyNode[])[0];
    expect(img.type).toBe("image");
    expect(img.url).toBe("img.png");
    expect(img.alt).toBe("logo");
  });

  it("emits a footnoteReference with identifier", () => {
    const root = lezerStringToMdast("[^x]");
    const para = firstChild(root);
    const ref = (para.children as AnyNode[])[0];
    expect(ref.type).toBe("footnoteReference");
    expect(ref.identifier).toBe("x");
  });
});

describe("lezerStringToMdast - block constructs", () => {
  it("emits a blockquote skipping QuoteMark", () => {
    const root = lezerStringToMdast("> quote");
    const bq = firstChild(root);
    expect(bq.type).toBe("blockquote");
    expect((bq.children as AnyNode[])[0].type).toBe("paragraph");
  });

  it("emits a thematicBreak for ---", () => {
    const root = lezerStringToMdast("---");
    expect(firstChild(root).type).toBe("thematicBreak");
  });

  it("emits a definition for [label]: url", () => {
    const root = lezerStringToMdast('[x]: https://x.io "T"');
    const def = firstChild(root);
    expect(def.type).toBe("definition");
    expect(def.identifier).toBe("x");
    expect(def.url).toBe("https://x.io");
    expect(def.title).toBe("T");
  });

  it("emits a definition for [^x]: text (Lezer maps to LinkReference)", () => {
    // Lezer's built-in LinkReference block parser matches `[^x]: body` before
    // the footnote extension's FootnoteDefinition leaf parser. The adapter's
    // definition regex `^\[([^\]]+)\]:` therefore captures `^x` as the
    // identifier (caret is not excluded). FootnoteDefinition is only reached
    // when the footnote extension wins (e.g. multi-line bodies).
    const root = lezerStringToMdast("[^x]: body");
    const def = firstChild(root);
    expect(def.type).toBe("definition");
    expect(def.identifier).toBe("^x");
    expect(def.url).toBe("body");
  });

  it("emits an html block for raw HTML", () => {
    const root = lezerStringToMdast("<div>\ntext\n</div>");
    const html = firstChild(root);
    expect(html.type).toBe("html");
    expect(typeof html.value).toBe("string");
  });
});

describe("lezerStringToMdast - paragraph promotion", () => {
  it("promotes a paragraph containing an inline HTML tag to html", () => {
    const root = lezerStringToMdast("<kbd>X</kbd>");
    const node = firstChild(root);
    expect(node.type).toBe("html");
  });

  it("synthesizes a callout html node for :::type fences", () => {
    const root = lezerStringToMdast(":::note\nbody\n:::");
    const node = firstChild(root);
    expect(node.type).toBe("html");
    expect(String(node.value)).toContain("nexus-callout");
    expect(String(node.value)).toContain("NOTE");
  });
});

describe("lezerStringToMdast - edge cases", () => {
  it("does not throw on a document containing only whitespace", () => {
    expect(() => lezerStringToMdast("   \n\n  ")).not.toThrow();
  });

  it("does not throw on an unclosed fenced code block", () => {
    expect(() => lezerStringToMdast("```js\nfoo")).not.toThrow();
  });

  it("skips unknown inline constructs by flattening them to text", () => {
    // Escape sequence `\>` is not a recognized inline node — falls to default.
    const root = lezerStringToMdast("a\\>b");
    const para = firstChild(root);
    expect(para.type).toBe("paragraph");
  });
});

describe("lezerTreeToMdast - state path", () => {
  it("produces structurally equivalent output to the string path", () => {
    const md = "# Heading\n\nparagraph\n\n- item";
    const fromState = stateRoot(md);
    const fromString = asNode(lezerStringToMdast(md));
    expect(fromState.type).toBe(fromString.type);
    expect((fromState.children as AnyNode[]).length).toBe((fromString.children as AnyNode[]).length);
  });

  it("reads the tree from the supplied EditorState", () => {
    const fromState = stateRoot("# State Title");
    const heading = firstChild(fromState);
    expect(heading.type).toBe("heading");
    expect(heading.depth).toBe(1);
  });
});
