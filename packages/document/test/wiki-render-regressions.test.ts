import { afterEach, describe, expect, it, vi } from "vitest";
import { unified, type Data } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { renderDocument } from "../src/render";
import { exportHtml } from "../src/export-html";
import type { DocumentRenderHandle } from "../src/types";
import { createWikiSourceMap } from "../src/wiki-source-map";

const handles: DocumentRenderHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.dispose()));
});

describe("wiki rendering source positions", () => {
  it.each([100, 2000])("parses %i wiki links once rather than reparsing every growing prefix", async (count) => {
    let parses = 0;
    let parsedCodeUnits = 0;
    const markdown = "[[Note]] ".repeat(count);
    const result = await exportHtml(markdown, {
      extensions: [{
        remarkPlugins: [function countParsing() {
          const parse = this.parser;
          if (!parse) throw new Error("Expected the Markdown parser");
          this.parser = (source, file) => {
            parses += 1;
            parsedCodeUnits += source.length;
            return parse(source, file);
          };
        }],
      }],
    });
    expect(result.html.match(/<span>Note<\/span>/g)).toHaveLength(count);
    expect(parses).toBe(1);
    expect(parsedCodeUnits).toBe(markdown.length);
  });

  it("observes source tokens without changing the parser's AST or normal GFM semantics", () => {
    const markdown = [
      "# &amp; [[Heading]]",
      "\nSetext &#x1F642; [[Heading]]\n---",
      "> &#0; &#xD800; &#128; &notAnEntity; [[Quote]]\r\n> next\\\r\n> [[Break]]",
      "- *escaped \\* [[List]]*\n  continuation [[Item]]",
      "| Left | Right |\n| --- | --- |\n| a\\|b &copy; [[Cell]] | ~~[[Strike]]~~ |",
      "`[[Inline]]` and <span>HTML &amp;</span>",
      "```txt\n[[Code]]\n```",
      "[Label &amp;][ref]\n\n[ref]: https://example.com \"&copy;\"",
    ].join("\n\n");
    const expected = unified().use(remarkParse).use(remarkGfm).parse(markdown);
    const positions = createWikiSourceMap();
    const parser = unified().use(remarkParse).use(remarkGfm).use(function capturePositions() {
      this.data("fromMarkdownExtensions", [
        ...(this.data("fromMarkdownExtensions") ?? []),
        positions.extension,
      ]);
    });
    expect(parser.parse(markdown)).toEqual(expected);
  });

  it.each([
    "[outer [[wiki]] tail](https://example.com)",
    "[outer [[wiki]] tail][ref]\n\n[ref]: https://example.com",
    "[outer **[[wiki]]** tail][ref]\n\n[ref]: https://example.com",
  ])("does not create nested wiki anchors inside an existing link: %s", async (markdown) => {
    const handle = renderDocument(markdown, { document });
    handles.push(handle);
    await handle.ready;
    const links = handle.element.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].textContent).toBe("outer [[wiki]] tail");
  });

  it.each([false, true])("preserves escaped/entity prefixes and multiline container text (snapshot=%s)", async (snapshot) => {
    const markdown = "> 😀 \\* &amp; &#x1F642; [[One|first]] tail\r\n> &copy; [[Two|second]] end\r\n\r\n- \\[[literal]] and [[Three|third]] after";
    const tree = unified().use(remarkParse).parse(markdown);
    const before = structuredClone(tree);
    const handle = renderDocument(snapshot ? { markdown, renderAst: tree } : markdown, { document });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.querySelector("blockquote p")?.textContent).toBe("😀 * & 🙂 first tail\n© second end");
    expect(handle.element.querySelector("li")?.textContent).toBe("[[literal]] and third after");
    expect(Array.from(handle.element.querySelectorAll("a"), (link) => link.textContent)).toEqual(["first", "second", "third"]);
    expect(tree).toEqual(before);
  });

  it("keeps supplied transformed text intact rather than applying stale source offsets", async () => {
    const markdown = "Prefix [[Note]] tail";
    const tree = unified().use(remarkParse).parse(markdown);
    const paragraph = tree.children[0];
    if (paragraph.type !== "paragraph" || paragraph.children[0].type !== "text") throw new Error("Expected text fixture");
    paragraph.children[0].value = "Host-transformed text";
    const transform = vi.fn((value: Root) => value);
    const handle = renderDocument({ markdown, renderAst: tree }, {
      document,
      extensions: [{ remarkPlugins: [() => transform] }],
    });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.textContent).toBe("Host-transformed text");
    expect(transform).not.toHaveBeenCalled();
  });

  it.each(["plain text", "[[Note]] tail"])("preserves a custom text compiler with or without wiki syntax: %s", async (markdown) => {
    type MarkdownExtension = Exclude<NonNullable<Data["fromMarkdownExtensions"]>[number], unknown[]>;
    const compiler: MarkdownExtension = {
      exit: {
        data(token) {
          const node = this.stack.pop();
          if (node?.type !== "text" || !node.position) throw new Error("Expected text fixture");
          node.value += this.sliceSerialize(token).toUpperCase();
          node.position.end = {
            line: token.end.line,
            column: token.end.column,
            offset: token.end.offset,
          };
        },
      },
    };
    const inspect = vi.fn((tree: Root) => tree);
    const handle = renderDocument(markdown, {
      document,
      extensions: [{
        remarkPlugins: [function customTextCompiler() {
          this.data("fromMarkdownExtensions", [
            ...(this.data("fromMarkdownExtensions") ?? []),
            [compiler],
          ]);
          return inspect;
        }],
      }],
    });
    handles.push(handle);
    await handle.ready;
    expect(inspect.mock.calls[0][0].children[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: markdown.toUpperCase() }],
    });
    expect(handle.element.textContent).toBe(markdown.toUpperCase());
    expect(handle.element.querySelector("a")).toBeNull();
    expect(handle.diagnostics).toEqual(markdown.includes("[[") ? [{
      code: "unsupported-content",
      message: "Wiki conversion was skipped to preserve a custom Markdown text compiler",
    }] : []);
  });
});
