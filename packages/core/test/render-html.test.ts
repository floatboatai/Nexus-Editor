// @vitest-environment node
//
// Runs WITHOUT jsdom on purpose: this file proves the HTML renderer works in a
// plain Node.js process (SSR / SSG / build scripts), where `document` and
// `window` do not exist.

import { describe, expect, it } from "vitest";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHtmlRenderer, renderMarkdownToHtml } from "../src/index";

describe("renderMarkdownToHtml (headless)", () => {
  it("runs in an environment without a DOM", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("renders basic Markdown to HTML without a DOM", () => {
    const html = renderMarkdownToHtml("# Hello\n\nSome **bold** text.");

    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("returns an empty string for an empty document", () => {
    expect(renderMarkdownToHtml("")).toBe("");
  });

  it("honours remark plugins contributed by NexusPlugin instances", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";

    expect(renderMarkdownToHtml(table)).not.toContain("<table>");
    expect(renderMarkdownToHtml(table, { plugins: [createGfmPreset()] })).toContain("<table>");
  });

  it("does not pass raw HTML through by default", () => {
    const html = renderMarkdownToHtml("before\n\n<script>alert(1)</script>\n\nafter");

    expect(html).not.toContain("<script");
    expect(html).toContain("<p>before</p>");
    expect(html).toContain("<p>after</p>");
  });

  it("applies an optional mdast transform before HTML conversion", () => {
    const html = renderMarkdownToHtml("# Title", {
      transform: (tree) => {
        for (const node of tree.children) {
          if (node.type === "heading") node.depth = 2;
        }
        return tree;
      },
    });

    expect(html).toContain("<h2>Title</h2>");
    expect(html).not.toContain("<h1>");
  });
});

describe("createHtmlRenderer", () => {
  it("can render many documents with one pipeline", () => {
    const renderer = createHtmlRenderer({ plugins: [createGfmPreset()] });

    expect(renderer.render("~~gone~~")).toContain("<del>gone</del>");
    expect(renderer.render("# Second")).toContain("<h1>Second</h1>");
    expect(renderer.render("# Second")).not.toContain("<del>");
  });

  it("produces the same output as the one-shot helper", () => {
    const markdown = "- [ ] todo\n- [x] done";
    const plugins = [createGfmPreset()];

    expect(createHtmlRenderer({ plugins }).render(markdown)).toBe(
      renderMarkdownToHtml(markdown, { plugins }),
    );
  });
});
