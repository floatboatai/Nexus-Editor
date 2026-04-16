import { describe, expect, it } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";

describe("live preview", () => {
  it("renders inline markdown nodes when the cursor is outside the syntax range", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** *italic* `code` [link](https://example.com)",
      livePreview: true
    });

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("a")?.textContent).toBe("link");
    editor.destroy();
  });

  it("restores raw markdown when the cursor enters a live preview range", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**",
      livePreview: true
    });

    expect(container.querySelector("strong")?.textContent).toBe("bold");

    editor.setSelection(8);

    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**bold**");
    editor.destroy();
  });

  it("renders headings, blockquotes, and images as block previews", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Heading\n\n> Quote\n\n![Alt](https://example.com/image.png)",
      livePreview: true
    });

    expect(container.querySelector("[data-heading-level='1']")?.textContent).toBe("Heading");
    expect(container.querySelector("blockquote")?.textContent).toBe("Quote");
    expect(container.querySelector("[data-live-preview-image]")?.getAttribute("data-live-preview-image")).toBe(
      "https://example.com/image.png"
    );
    editor.destroy();
  });

  it("renders strikethrough as del element when GFM is enabled", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text ~~deleted~~",
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    expect(container.querySelector("del")?.textContent).toBe("deleted");
    editor.destroy();
  });

  it("renders thematic break as hr element", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n---\n\nMore",
      livePreview: true
    });

    expect(container.querySelector("hr")).not.toBeNull();
    editor.destroy();
  });

  it("allows host renderers to override default node rendering", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Heading",
      livePreview: {
        renderers: {
          heading({ text }) {
            const element = document.createElement("div");
            element.setAttribute("data-heading", "custom");
            element.textContent = text.toUpperCase();
            return element;
          }
        }
      }
    });

    expect(container.querySelector("[data-heading='custom']")?.textContent).toBe("HEADING");
    editor.destroy();
  });

  it("passes the raw markdown source into custom renderers", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**",
      livePreview: {
        renderers: {
          strong({ source }) {
            const element = document.createElement("span");
            element.setAttribute("data-source", source);
            return element;
          }
        }
      }
    });

    expect(container.querySelector("[data-source]")?.getAttribute("data-source")).toBe("**bold**");
    editor.destroy();
  });

  it("uses default renderers for node types that are not overridden", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** *italic*",
      livePreview: {
        renderers: {
          strong({ text }) {
            const element = document.createElement("span");
            element.textContent = text.toUpperCase();
            return element;
          }
        }
      }
    });

    expect(container.querySelector("span")?.textContent).toBe("BOLD");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    editor.destroy();
  });

  it("re-renders live preview decorations after document updates", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**",
      livePreview: true
    });

    editor.setDocument("Text **changed**");

    expect(container.querySelector("strong")?.textContent).toBe("changed");
    editor.destroy();
  });
});
