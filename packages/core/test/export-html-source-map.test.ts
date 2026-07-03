import { describe, expect, it } from "vitest";

import { createEditor, SOURCE_MAP_FROM_ATTR, SOURCE_MAP_TO_ATTR } from "../src/index";

const DOC = "# One\n\nfirst paragraph\n\n## Two\n\nsecond paragraph\n\n```js\ncode();\n```\n";

function render(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("exportHTML sourceMap", () => {
  it("emits no source-map attributes by default", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: DOC });

    const html = editor.exportHTML();

    expect(html).toContain("<h1>One</h1>");
    expect(html).not.toContain(SOURCE_MAP_FROM_ATTR);
    expect(html).not.toContain(SOURCE_MAP_TO_ATTR);
    editor.destroy();
  });

  it("stamps top-level blocks with their markdown source range", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: DOC });

    const host = render(editor.exportHTML({ sourceMap: true }));

    const h2 = host.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(Number(h2!.getAttribute(SOURCE_MAP_FROM_ATTR))).toBe(DOC.indexOf("## Two"));
    expect(Number(h2!.getAttribute(SOURCE_MAP_TO_ATTR))).toBe(DOC.indexOf("## Two") + "## Two".length);

    const pre = host.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(Number(pre!.getAttribute(SOURCE_MAP_FROM_ATTR))).toBe(DOC.indexOf("```js"));
    editor.destroy();
  });

  it("stamps every top-level block with monotonically increasing ranges", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: DOC });

    const host = render(editor.exportHTML({ sourceMap: true }));
    const blocks = Array.from(host.children);

    expect(blocks.length).toBeGreaterThanOrEqual(5);
    let lastFrom = -1;
    for (const block of blocks) {
      const from = Number(block.getAttribute(SOURCE_MAP_FROM_ATTR));
      const to = Number(block.getAttribute(SOURCE_MAP_TO_ATTR));
      expect(Number.isFinite(from)).toBe(true);
      expect(to).toBeGreaterThan(from);
      expect(from).toBeGreaterThan(lastFrom);
      lastFrom = from;
    }
    editor.destroy();
  });

  it("does not stamp inline elements", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "some **bold** text\n" });

    const host = render(editor.exportHTML({ sourceMap: true }));

    expect(host.querySelector("p")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(true);
    expect(host.querySelector("strong")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(false);
    editor.destroy();
  });

  it("stamps list items instead of the list container", () => {
    const doc = "- alpha\n- beta\n- gamma\n";
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const host = render(editor.exportHTML({ sourceMap: true }));

    expect(host.querySelector("ul")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(false);
    const items = Array.from(host.querySelectorAll("li"));
    expect(items).toHaveLength(3);
    expect(Number(items[1].getAttribute(SOURCE_MAP_FROM_ATTR))).toBe(doc.indexOf("- beta"));
    editor.destroy();
  });

  it("descends into nested lists so outline documents get fine-grained anchors", () => {
    const doc = "- item one\n  - nested a\n  - nested b\n- item two\n";
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const host = render(editor.exportHTML({ sourceMap: true }));
    const stamped = Array.from(host.querySelectorAll(`[${SOURCE_MAP_FROM_ATTR}]`));

    // One anchor per leaf item, not one anchor for the whole outline.
    expect(stamped.length).toBeGreaterThanOrEqual(3);
    const nestedA = stamped.find(
      (el) => Number(el.getAttribute(SOURCE_MAP_FROM_ATTR)) === doc.indexOf("- nested a")
    );
    expect(nestedA?.tagName).toBe("LI");
    editor.destroy();
  });

  it("does not stamp inline elements inside tight list items", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- has **bold** text\n" });

    const host = render(editor.exportHTML({ sourceMap: true }));

    expect(host.querySelector("li")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(true);
    expect(host.querySelector("strong")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(false);
    editor.destroy();
  });

  it("stamps blockquote content instead of the blockquote container", () => {
    const doc = "intro\n\n> quoted line\n";
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const host = render(editor.exportHTML({ sourceMap: true }));
    const quote = host.querySelector("blockquote")!;

    expect(quote.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(false);
    expect(quote.querySelector("p")!.hasAttribute(SOURCE_MAP_FROM_ATTR)).toBe(true);
    editor.destroy();
  });
});
