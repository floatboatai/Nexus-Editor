import { describe, expect, it } from "vitest";
import type { Heading, Root } from "mdast";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";

function headings(markdown: string): Heading[] {
  const ast: Root = lezerStringToMdast(markdown);
  return ast.children.filter((node): node is Heading => node.type === "heading");
}

/** Concatenate the text content of a heading's inline children. */
function headingText(heading: Heading): string {
  let text = "";
  const walk = (node: { value?: string; children?: unknown[] }): void => {
    if (typeof node.value === "string") text += node.value;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child as { value?: string; children?: unknown[] });
    }
  };
  walk(heading);
  return text;
}

describe("lezer→mdast headings", () => {
  it("keeps the text of a setext h1", () => {
    const [heading] = headings("Title Here\n==========");
    expect(heading.depth).toBe(1);
    expect(headingText(heading)).toBe("Title Here");
  });

  it("keeps the text of a setext h2", () => {
    const [heading] = headings("Sub Title\n---------");
    expect(heading.depth).toBe(2);
    expect(headingText(heading)).toBe("Sub Title");
  });

  it("keeps inline marks inside a setext heading", () => {
    const [heading] = headings("A **bold** word\n===============");
    expect(headingText(heading)).toBe("A bold word");
    expect(heading.children.some((child) => child.type === "strong")).toBe(true);
  });

  it("reports the same text for equivalent setext and ATX headings", () => {
    const setext = headings("Same Words\n==========");
    const atx = headings("# Same Words");
    expect(headingText(setext[0])).toBe(headingText(atx[0]));
    expect(setext[0].depth).toBe(atx[0].depth);
  });

  it("strips ATX opening markers", () => {
    expect(headingText(headings("# Plain")[0])).toBe("Plain");
    expect(headings("###### Six")[0].depth).toBe(6);
  });

  it("keeps the text of a closed ATX heading", () => {
    expect(headingText(headings("## Closed ##")[0])).toBe("Closed");
    expect(headings("## Closed ##")[0].depth).toBe(2);
    expect(headingText(headings("## Trail #")[0])).toBe("Trail");
    expect(headingText(headings("###### Six ######")[0])).toBe("Six");
  });

  it("keeps inline marks inside a closed ATX heading", () => {
    const [heading] = headings("## A **bold** word ##");
    expect(headingText(heading)).toBe("A bold word");
    expect(heading.children.some((child) => child.type === "strong")).toBe(true);
  });

  it("spans the underline in the heading position", () => {
    const source = "Title\n=====";
    const [heading] = headings(source);
    expect(heading.position?.start.offset).toBe(0);
    expect(heading.position?.end.offset).toBe(source.length);
  });

  it("handles an empty setext heading without throwing", () => {
    expect(() => headings("\n===")).not.toThrow();
  });
});
