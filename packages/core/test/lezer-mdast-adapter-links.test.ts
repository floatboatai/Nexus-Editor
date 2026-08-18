import { describe, expect, it } from "vitest";
import type { Definition, Image, Link, LinkReference, Paragraph, Root, RootContent } from "mdast";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";

/** The first `definition` node in the document. */
function definition(markdown: string): Definition {
  const ast: Root = lezerStringToMdast(markdown);
  const node = ast.children.find((child): child is Definition => child.type === "definition");
  if (!node) throw new Error(`no definition in ${JSON.stringify(markdown)}`);
  return node;
}

/** First inline child of the first paragraph — the node under test. */
function firstInline(markdown: string): RootContent {
  const ast: Root = lezerStringToMdast(markdown);
  const paragraph = ast.children.find((node): node is Paragraph => node.type === "paragraph");
  if (!paragraph) throw new Error(`no paragraph in ${JSON.stringify(markdown)}`);
  return paragraph.children[0] as RootContent;
}

describe("lezer→mdast link titles", () => {
  it("reads a double-quoted link title", () => {
    const link = firstInline(`[text](/url "the title")`) as Link;
    expect(link.type).toBe("link");
    expect(link.url).toBe("/url");
    expect(link.title).toBe("the title");
  });

  it("reads single-quoted and parenthesised link titles", () => {
    expect((firstInline(`[text](/url 'sq title')`) as Link).title).toBe("sq title");
    expect((firstInline(`[text](/url (paren title))`) as Link).title).toBe("paren title");
  });

  it("reads an image title", () => {
    const image = firstInline(`![alt](/img.png "img title")`) as Image;
    expect(image.type).toBe("image");
    expect(image.url).toBe("/img.png");
    expect(image.alt).toBe("alt");
    expect(image.title).toBe("img title");
  });

  it("leaves title null when the source has none", () => {
    expect((firstInline(`[text](/url)`) as Link).title).toBeNull();
    expect((firstInline(`![alt](/img.png)`) as Image).title).toBeNull();
    expect((firstInline(`<https://auto.example>`) as Link).title).toBeNull();
  });

  it("normalises an empty title to null, matching remark", () => {
    expect((firstInline(`[text](/url "")`) as Link).title).toBeNull();
    expect((firstInline(`![a](/i "")`) as Image).title).toBeNull();
  });

  it("preserves whitespace inside a title", () => {
    expect((firstInline(`[text](/url "  spaced  ")`) as Link).title).toBe("  spaced  ");
  });

  it("keeps the title out of the link label", () => {
    const link = firstInline(`[text](/url "the title")`) as Link;
    expect(link.children).toHaveLength(1);
    expect(link.children[0]).toMatchObject({ type: "text", value: "text" });
  });
});

describe("lezer→mdast angle-bracketed destinations", () => {
  it("unwraps <> around a link or image url", () => {
    // CommonMark allows `<…>` so a destination can contain spaces; the brackets
    // are delimiters, not part of the url.
    expect((firstInline(`[a](</spaced url> "t")`) as Link).url).toBe("/spaced url");
    expect((firstInline(`![i](</sp img.png>)`) as Image).url).toBe("/sp img.png");
  });
});

describe("lezer→mdast reference links", () => {
  it("emits a linkReference for the full form", () => {
    const node = firstInline(`[full][ref]\n\n[ref]: /target "T"`);
    expect(node).toMatchObject({
      type: "linkReference",
      identifier: "ref",
      label: "ref",
      referenceType: "full",
    });
    expect((node as LinkReference).children[0]).toMatchObject({ type: "text", value: "full" });
  });

  it("emits a linkReference for the collapsed form", () => {
    expect(firstInline(`[collapsed][]\n\n[collapsed]: /c`)).toMatchObject({
      type: "linkReference",
      identifier: "collapsed",
      label: "collapsed",
      referenceType: "collapsed",
    });
  });

  it("emits a linkReference for the shortcut form", () => {
    expect(firstInline(`[shortcut]\n\n[shortcut]: /s`)).toMatchObject({
      type: "linkReference",
      identifier: "shortcut",
      label: "shortcut",
      referenceType: "shortcut",
    });
  });

  it("no longer reports the raw source as the url", () => {
    // Regression: the adapter used to emit `{type:"link", url:"[full][ref]"}`,
    // which exported as <a href="[full][ref]"> — a dead link.
    const node = firstInline(`[full][ref]\n\n[ref]: /target`) as { url?: string };
    expect(node.url).toBeUndefined();
  });

  it("case-folds the identifier but keeps the author's label", () => {
    expect(firstInline(`[a][MyRef]\n\n[MyRef]: /u`)).toMatchObject({
      identifier: "myref",
      label: "MyRef",
    });
  });

  it("keeps nested inline marks in the reference label", () => {
    const node = firstInline(`[**bold**][ref]\n\n[ref]: /b`) as LinkReference;
    expect(node.type).toBe("linkReference");
    expect(node.children[0]).toMatchObject({ type: "strong" });
  });

  it("emits an imageReference with alt text", () => {
    expect(firstInline(`![imgref][ir]\n\n[ir]: /i.png "IT"`)).toMatchObject({
      type: "imageReference",
      identifier: "ir",
      label: "ir",
      referenceType: "full",
      alt: "imgref",
    });
  });

  it("emits an imageReference for the collapsed form", () => {
    expect(firstInline(`![imgcollapsed][]\n\n[imgcollapsed]: /ic`)).toMatchObject({
      type: "imageReference",
      identifier: "imgcollapsed",
      referenceType: "collapsed",
      alt: "imgcollapsed",
    });
  });

  it("still emits a plain link for the inline form", () => {
    expect(firstInline(`[inline](/u)`)).toMatchObject({ type: "link", url: "/u" });
  });
});

describe("lezer→mdast definitions", () => {
  it("lower-cases identifier but keeps label verbatim", () => {
    const def = definition(`[MyRef]: /u`);
    expect(def.identifier).toBe("myref");
    expect(def.label).toBe("MyRef");
  });

  it("reads all three title delimiter forms", () => {
    expect(definition(`[r]: /u "dq"`).title).toBe("dq");
    expect(definition(`[r]: /u 'sq'`).title).toBe("sq");
    expect(definition(`[r]: /u (paren)`).title).toBe("paren");
    expect(definition(`[r]: /u`).title).toBeNull();
  });

  it("unwraps an angle-bracketed definition url", () => {
    const def = definition(`[r]: </spaced url> "T"`);
    expect(def.url).toBe("/spaced url");
    expect(def.title).toBe("T");
  });

  it("keeps a multi-word label matchable by its identifier", () => {
    const def = definition(`[Multi Word Ref]: /m`);
    expect(def.identifier).toBe("multi word ref");
    expect(def.label).toBe("Multi Word Ref");
  });
});
