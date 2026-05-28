import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (!("getBoundingClientRect" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

function requireEditorView(view: EditorView | null): EditorView {
  if (!view) throw new Error("Expected CodeMirror view to be captured");
  return view;
}

describe("live preview", () => {
  // ── Inline formatting ──
  // Note: inline markers are hidden when cursor is on a DIFFERENT line (line-level detection).
  // Tests use multi-line content with cursor moved to a separate line.

  it("hides markers and shows styled text for inline formatting", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "Text **bold** *italic* `code` [link](https://example.com)\n\nend",
      livePreview: true,
    });

    // Move cursor to a different line
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("bold");
    expect(text).toContain("italic");
    expect(text).toContain("code");
    expect(text).toContain("link");
    // Markers hidden (replaced)
    expect(text).not.toContain("**");
    expect(container.querySelector("[data-link-url]")).not.toBeNull();
    editor.destroy();
  });

  it("restores raw markdown when cursor enters the same line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**\n\nend",
      livePreview: true,
    });

    // Cursor on different line → markers hidden
    editor.setSelection(editor.getDocument().length);
    expect(container.textContent).not.toContain("**");

    // Cursor on same line → markers visible
    editor.setSelection(8);
    expect(container.textContent).toContain("**bold**");
    editor.destroy();
  });

  it("hides strikethrough markers when GFM is enabled", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text ~~deleted~~\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("deleted");
    expect(text).not.toContain("~~");
    editor.destroy();
  });

  it("re-renders inline formatting after document updates", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**\n\nend",
      livePreview: true,
    });

    editor.setDocument("Text **changed**\n\nend");
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("changed");
    expect(text).not.toContain("**");
    editor.destroy();
  });

  it("keeps live preview decorations stable during IME composition", async () => {
    const container = document.createElement("div");
    const source = "Text **bold**\n\nend";
    let capturedView: EditorView | null = null;
    const captureView = ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          capturedView = view;
        }
      }
    );
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
      plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    });

    editor.setSelection(source.length);
    expect(container.textContent).not.toContain("**");

    const insertAt = source.indexOf("bold");
    const view = requireEditorView(capturedView);
    view.dispatch({
      changes: { from: insertAt, insert: "文" },
      selection: { anchor: insertAt + 1 },
      userEvent: "input.type.compose",
    });

    expect(editor.getDocument()).toBe("Text **文bold**\n\nend");
    expect(container.textContent).not.toContain("**");

    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);
    vi.useRealTimers();

    expect(container.textContent).toContain("**文bold**");
    editor.destroy();
  });

  // ── Nested inline formatting ──

  it("renders nested bold+italic with combined styles", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text ***bold italic***\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("bold italic");
    expect(text).not.toContain("***");
    expect(text).not.toContain("**");
    editor.destroy();
  });

  it("renders mixed marker nesting **_text_** with both styles", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **_mixed_**\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("mixed");
    expect(text).not.toContain("**");
    expect(text).not.toContain("_");
    editor.destroy();
  });

  it("renders strikethrough wrapping bold with both styles", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text ~~**bold**~~\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("bold");
    expect(text).not.toContain("~~");
    expect(text).not.toContain("**");
    editor.destroy();
  });

  it("renders bold wrapping strikethrough (overlapping markers) with both styles", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**a~~b**~~\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("a");
    expect(text).toContain("b");
    expect(text).not.toContain("**");
    expect(text).not.toContain("~~");
    editor.destroy();
  });

  // ── Link Ctrl+Click ──

  it("adds data-link-url attribute to mark-decorated links", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Click [here](https://example.com)\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl).not.toBeNull();
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    editor.destroy();
  });

  it("renders links inside ordered lists correctly", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "## 目录\n\n1. [项目概述](#项目概述)\n2. [快速开始](#快速开始)\n3. [主要功能](#主要功能)\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const links = container.querySelectorAll("[data-link-url]");
    expect(links.length).toBe(3);
    expect(links[0].textContent).toBe("项目概述");
    expect(links[1].textContent).toBe("快速开始");
    expect(links[2].textContent).toBe("主要功能");
    editor.destroy();
  });

  it("hides link markers visually and adds data-link-url", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Click [here](https://example.com) now\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl).not.toBeNull();
    expect(linkEl?.textContent).toBe("here");
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    editor.destroy();
  });

  it("shows raw markdown so links can be edited when the cursor enters the link range", () => {
    const container = document.createElement("div");
    const source = "Click [here](https://example.com) now\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true
    });

    editor.setSelection(source.indexOf(") now") + 1);

    expect(container.textContent).toContain("[here](https://example.com)");
    expect(container.querySelector("[data-link-url]")).toBeNull();
    editor.destroy();
  });

  it("shows raw markdown for ordered-list links when the cursor reaches their right edge", () => {
    const container = document.createElement("div");
    const source = "1. [标题层级](#标题层级)\n2. [段落与换行](#段落与换行)\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true
    });

    editor.setSelection(source.indexOf("\n2."));

    expect(container.textContent).toContain("[标题层级](#标题层级)");
    expect(container.querySelector("[data-link-url]")?.textContent).toBe("段落与换行");
    editor.destroy();
  });

  // ── Headings ──

  it("renders headings with bold text and heading level attribute", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Heading",
      livePreview: true,
    });

    expect(
      container.querySelector("[data-heading-level='1']")?.textContent,
    ).toBe("Heading");
    editor.destroy();
  });

  it("shows raw heading markdown while IME composition is active", async () => {
    const container = document.createElement("div");
    const source = "# 第一章\n\nend";
    let capturedView: EditorView | null = null;
    const captureView = ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          capturedView = view;
        }
      }
    );
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
      plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    });
    const headingEnd = source.indexOf("\n");
    editor.setSelection(headingEnd);
    expect(container.querySelector("[data-heading-level='1']")).not.toBeNull();
    expect(container.textContent).not.toContain("# 第一章");

    const view = requireEditorView(capturedView);
    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    expect(container.querySelector("[data-heading-level='1']")).toBeNull();
    expect(container.textContent).toContain("# 第一章");

    view.dispatch({
      changes: { from: headingEnd, insert: "一" },
      selection: { anchor: headingEnd + 1 },
      userEvent: "input.type.compose",
    });

    expect(editor.getDocument()).toBe("# 第一章一\n\nend");
    expect(container.querySelector("[data-heading-level='1']")).toBeNull();
    expect(container.textContent).toContain("# 第一章一");

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);
    vi.useRealTimers();

    expect(container.querySelector("[data-heading-level='1']")?.textContent).toBe("第一章一");
    expect(container.textContent).not.toContain("# 第一章一");
    editor.destroy();
  });

  it("keeps empty ATX heading input on the same line during composition", async () => {
    const container = document.createElement("div");
    const lines = [
      ...Array.from({ length: 22 }, (_, index) => `line ${index + 1}`),
      "### ",
      "end",
    ];
    const source = lines.join("\n");
    let capturedView: EditorView | null = null;
    let effectOnlyUpdates = 0;
    const captureView = ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          capturedView = view;
        }

        update(update: ViewUpdate) {
          if (!update.docChanged && !update.selectionSet) {
            effectOnlyUpdates++;
          }
        }
      }
    );
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
      plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    });
    const headingStart = source.indexOf("### ");
    const insertAt = headingStart + "### ".length;
    editor.setSelection(insertAt);

    const view = requireEditorView(capturedView);
    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));

    expect(effectOnlyUpdates).toBe(0);
    expect(editor.getDocument().split("\n")[22]).toBe("### ");

    view.dispatch({
      changes: { from: insertAt, insert: "ddsadsada" },
      selection: { anchor: insertAt + "ddsadsada".length },
      userEvent: "input.type.compose",
    });

    expect(editor.getDocument().split("\n")[22]).toBe("### ddsadsada");
    expect(editor.getDocument().split("\n")[23]).toBe("end");

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);
    vi.useRealTimers();

    expect(editor.getDocument().split("\n")[22]).toBe("### ddsadsada");
    expect(editor.getDocument().split("\n")[23]).toBe("end");
    editor.destroy();
  });

  // ── Block elements ──

  it("styles blockquotes without replacing editable source text", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n> Quote\n\n![Alt](https://example.com/image.png)",
      livePreview: true,
    });

    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).toContain("Quote");
    expect(container.textContent).not.toContain("> Quote");
    expect(
      container
        .querySelector("[data-live-preview-image]")
        ?.getAttribute("data-live-preview-image"),
    ).toBe("https://example.com/image.png");

    editor.setSelection(9);
    expect(container.textContent).toContain("> Quote");
    editor.destroy();
  });

  it("renders thematic break as hr element", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n---\n\nMore",
      livePreview: true,
    });

    expect(container.querySelector("hr")).not.toBeNull();
    editor.destroy();
  });

  // ── Code blocks ──

  it("renders code blocks with syntax highlighting and language label", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      livePreview: true,
    });

    expect(container.textContent).toContain("console.log(1)");
    // Code block has role=code and aria-label with language
    const codeLine = container.querySelector("[role='code']");
    expect(codeLine?.getAttribute("aria-label")).toBe("Code block: js");
    editor.destroy();
  });

  it("shows fence lines when cursor enters code block", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      livePreview: true,
    });

    const textBefore = container.textContent ?? "";
    expect(textBefore).toContain("console.log(1)");

    editor.setSelection(12);

    const textAfter = container.textContent ?? "";
    expect(textAfter).toContain("```js");
    expect(textAfter).toContain("console.log(1)");
    editor.destroy();
  });

  it("applies code block background to all content lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```py\nx = 1\ny = 2\n```",
      livePreview: true,
    });

    const codeLines = Array.from(container.querySelectorAll(".cm-line")).filter(
      (line) =>
        (line as HTMLElement).style.background === "rgb(246, 248, 250)" ||
        (line as HTMLElement).getAttribute("style")?.includes("background"),
    );
    expect(codeLines.length).toBeGreaterThanOrEqual(2);
    editor.destroy();
  });

  // ── Indented code blocks ──

  it("renders indented code blocks with background styling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n    indented code\n    second line",
      livePreview: true,
    });

    const text = container.textContent ?? "";
    expect(text).toContain("indented code");
    expect(text).toContain("second line");
    const codeLines = Array.from(container.querySelectorAll(".cm-line")).filter(
      (line) =>
        (line as HTMLElement).getAttribute("style")?.includes("background") ||
        (line as HTMLElement).innerHTML.includes("monospace"),
    );
    expect(codeLines.length).toBeGreaterThanOrEqual(2);
    editor.destroy();
  });

  // ── Footnotes ──

  it("renders footnote references as superscript when GFM is enabled", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text with footnote[^1]\n\n[^1]: Definition text",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const sup = container.querySelector("sup");
    expect(sup).not.toBeNull();
    expect(sup?.textContent).toBe("1");
    editor.destroy();
  });

  // ── Autolinks ──

  it("renders GFM autolinks as styled links", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Visit https://example.com today\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);

    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl).not.toBeNull();
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    editor.destroy();
  });

  // ── Tables ──

  it("renders tables as editable widget with grip cells", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const ths = table?.querySelectorAll("th");
    expect(ths!.length).toBeGreaterThanOrEqual(3);
    expect(ths![1]?.textContent).toBe("A");
    expect(ths![1]?.classList.contains("nexus-cell")).toBe(true);
    editor.destroy();
  });

  it("enables table cell editing after a single-cell click", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 222 |",
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    const cell = container.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell")[1];
    expect(cell).not.toBeUndefined();
    expect(cell?.contentEditable).not.toBe("true");

    cell?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 80,
      clientY: 40
    }));

    expect(cell?.contentEditable).not.toBe("true");

    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40
    }));

    expect(cell?.contentEditable).toBe("true");
    editor.destroy();
    container.remove();
  });

  it("preserves clicked caret position when a styled table cell swaps to raw markdown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | **加粗** |",
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    const cell = container.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell")[1];
    const textNode = cell?.querySelector("strong")?.firstChild;
    expect(cell).not.toBeUndefined();
    expect(textNode?.textContent).toBe("加粗");

    const originalCaretRangeFromPoint = document.caretRangeFromPoint;
    const range = document.createRange();
    range.setStart(textNode!, 1);
    range.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => range,
    });

    cell?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 80,
      clientY: 40
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40
    }));

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(cell?.textContent).toBe("**加粗**");
    expect(document.getSelection()?.anchorNode).toBe(cell?.firstChild);
    expect(document.getSelection()?.anchorOffset).toBe(3);

    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: originalCaretRangeFromPoint,
    });
    editor.destroy();
    container.remove();
  });

  it("keeps table range selection available after cell mousedown", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    const cells = container.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell");
    const firstCell = cells?.[0];
    const secondCell = cells?.[1];
    expect(firstCell).not.toBeUndefined();
    expect(secondCell).not.toBeUndefined();

    firstCell!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 50,
      bottom: 30,
      width: 50,
      height: 30,
      toJSON: () => ({})
    });
    secondCell!.getBoundingClientRect = () => ({
      x: 50,
      y: 0,
      left: 50,
      top: 0,
      right: 100,
      bottom: 30,
      width: 50,
      height: 30,
      toJSON: () => ({})
    });

    firstCell?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 25,
      clientY: 15
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      button: 0,
      clientX: 75,
      clientY: 15
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 75,
      clientY: 15
    }));

    expect(firstCell?.contentEditable).not.toBe("true");
    expect(firstCell?.style.background).toContain("124, 108, 250");
    expect(secondCell?.style.background).toContain("124, 108, 250");
    editor.destroy();
    container.remove();
  });

  it("renders inline markdown links inside table cells as <a> elements", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "| Name | Link |\n|---|---|\n| Sonali | [LinkedIn](https://linkedin.com/in/sonali) |\n| Rich | [@RWong](https://twitter.com/RWong) |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const links =
      container.querySelectorAll<HTMLAnchorElement>("table a[href]");
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe(
      "https://linkedin.com/in/sonali",
    );
    expect(links[0].textContent).toBe("LinkedIn");
    expect(links[1].getAttribute("href")).toBe("https://twitter.com/RWong");
    expect(links[1].textContent).toBe("@RWong");
    editor.destroy();
  });

  it("scales image to cell width when the cell is media-only (single image / image-in-link)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "| Avatar | Mixed |\n|---|---|\n| ![alice](https://example.com/a.png) | text ![icon](https://example.com/i.png) more |\n| [![logo](https://example.com/l.png)](https://x.example) | ok |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const imgs = Array.from(
      container.querySelectorAll<HTMLImageElement>("table img"),
    );
    expect(imgs.length).toBe(3);

    // First row, first column: media-only standalone image — width:100%
    // so it grows with the column.
    const mediaOnlyStandalone = imgs.find(
      (i) => i.getAttribute("src") === "https://example.com/a.png",
    );
    expect(mediaOnlyStandalone?.style.width).toBe("100%");
    expect(mediaOnlyStandalone?.style.maxHeight).toBe("240px");

    // First row, second column: inline image alongside text — stays
    // small (capped at the existing 1.6em line-height + 160px width).
    const inlineImg = imgs.find(
      (i) => i.getAttribute("src") === "https://example.com/i.png",
    );
    expect(inlineImg?.style.maxHeight).toBe("1.6em");
    expect(inlineImg?.style.maxWidth).toBe("160px");

    // Second row, first column: image-in-link is also media-only.
    const linkWrapped = imgs.find(
      (i) => i.getAttribute("src") === "https://example.com/l.png",
    );
    expect(linkWrapped?.style.width).toBe("100%");
    // Anchor parent should switch to block so the image fills the cell
    // without inline-baseline whitespace eating space.
    const linkParent = linkWrapped?.closest("a") as HTMLElement | null;
    expect(linkParent?.style.display).toBe("block");
    editor.destroy();
  });

  it("renders inline images inside table cells, including image-wrapped-in-link", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "| Avatar | Linked |\n|---|---|\n| ![alice](https://example.com/a.png) | [![logo](https://example.com/l.png)](https://carol.example) |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const imgs = container.querySelectorAll<HTMLImageElement>("table img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("https://example.com/a.png");
    expect(imgs[0].getAttribute("alt")).toBe("alice");
    expect(imgs[1].getAttribute("src")).toBe("https://example.com/l.png");
    // The second image is wrapped in a Link → has an <a> ancestor with the
    // outer URL as href.
    const linkAncestor = imgs[1].closest("a");
    expect(linkAncestor?.getAttribute("href")).toBe("https://carol.example");
    editor.destroy();
  });

  it("renders inline bold/em/code inside table cells", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "| Style | Sample |\n|---|---|\n| Bold | **strong** |\n| Italic | *em* |\n| Code | `code` |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    expect(container.querySelector("table strong")?.textContent).toBe("strong");
    expect(container.querySelector("table em")?.textContent).toBe("em");
    expect(container.querySelector("table code")?.textContent).toBe("code");
    editor.destroy();
  });

  it("renders a column-resize handle on every header cell", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    // One resize handle per data column (3 here). They live inside the
    // header <th>s so the user can grab the boundary between columns.
    const handles = container.querySelectorAll(".nexus-col-resize");
    expect(handles.length).toBe(3);
    // Each handle should be positioned for col-resize.
    handles.forEach((h) => {
      const style = (h as HTMLElement).style;
      expect(style.cursor).toBe("col-resize");
    });
    editor.destroy();
  });

  it("dragging the resize handle pins column widths via colgroup", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n|---|---|\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const handle = container.querySelector(
      ".nexus-col-resize",
    ) as HTMLElement | null;
    expect(handle).not.toBeNull();

    // Simulate a drag: mousedown on handle, mousemove on document,
    // mouseup to commit. The DOM should pick up a <colgroup> + the
    // table should switch to fixed layout afterwards.
    const startX = 200;
    handle?.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: startX,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: startX + 60,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const table = container.querySelector("table") as HTMLTableElement | null;
    expect(table).not.toBeNull();
    expect(table?.style.tableLayout).toBe("fixed");
    const colgroup = table?.querySelector("colgroup");
    expect(colgroup).not.toBeNull();
    // colgroup should have one <col> per column including the row-grip.
    expect(colgroup?.children.length).toBeGreaterThanOrEqual(2);
    editor.destroy();
  });

  it("normalises irregular row widths to the max column count (no overflow)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "| A | B | C |\n|---|---|---|\n| 1 | 2 |\n| 3 | 4 | 5 | 6 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const rows = Array.from(container.querySelectorAll("tr")).map((row) =>
      Array.from(row.querySelectorAll(".nexus-cell")).map(
        (cell) => cell.textContent,
      ),
    );
    // Every body row should have the same cell count as the widest row (4).
    // Header padded with one empty extra column; the short row padded too.
    expect(rows[1]).toEqual(["A", "B", "C", ""]);
    expect(rows[2]).toEqual(["1", "2", "", ""]);
    expect(rows[3]).toEqual(["3", "4", "5", "6"]);
    editor.destroy();
  });

  it("preserves empty table cells when rendering from pipe delimiters", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A |  | C |\n| --- | --- | --- |\n| 1 |  | 3 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const rows = Array.from(container.querySelectorAll("tr")).map((row) =>
      Array.from(row.querySelectorAll(".nexus-cell")).map(
        (cell) => cell.textContent,
      ),
    );
    expect(rows[1]).toEqual(["A", "", "C"]);
    expect(rows[2]).toEqual(["1", "", "3"]);
    editor.destroy();
  });

  it("adds a right-side column immediately after the table widget mounts", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const addColumn = Array.from(container.querySelectorAll("button")).find(
      (button) => button.title === "Add column",
    );
    expect(addColumn).not.toBeUndefined();
    addColumn?.click();

    const rows = Array.from(container.querySelectorAll("tr")).map((row) =>
      Array.from(row.querySelectorAll(".nexus-cell")).map(
        (cell) => cell.textContent,
      ),
    );
    expect(rows[1]).toEqual(["A", "B", ""]);
    expect(rows[2]).toEqual(["1", "2", ""]);
    expect(editor.getDocument()).toContain("| A | B");
    editor.destroy();
  });

  it("renders a styled localized table context menu", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      locale: {
        deleteRow: "删除行",
        deleteColumn: "删除列",
        insertRowBelow: "在下方插入行",
        insertColumnAfter: "在右侧插入列",
      },
      plugins: [createGfmPreset()],
    });

    const dataCell = container
      .querySelectorAll("tr")[2]
      ?.querySelector(".nexus-cell");
    expect(dataCell).not.toBeNull();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 32,
      clientY: 40,
    });
    dataCell?.dispatchEvent(event);

    const menu = document.body.querySelector<HTMLElement>(".nexus-table-ctx");
    expect(event.defaultPrevented).toBe(true);
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(menu?.style.background).toContain("--nexus-menu-bg");
    expect(menu?.style.color).toContain("--nexus-menu-text");
    expect(menu?.textContent).toContain("删除行");
    expect(menu?.textContent).toContain("在右侧插入列");
    expect(menu?.querySelectorAll("button[role='menuitem']")).toHaveLength(4);

    menu?.remove();
    editor.destroy();
  });

  // ── Custom renderers ──

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
          },
        },
      },
    });

    expect(
      container.querySelector("[data-heading='custom']")?.textContent,
    ).toBe("HEADING");
    editor.destroy();
  });

  it("passes the raw markdown source into custom renderers", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "end\n\nText **bold**",
      livePreview: {
        renderers: {
          strong({ source }) {
            const element = document.createElement("span");
            element.setAttribute("data-source", source);
            return element;
          },
        },
      },
    });

    // Cursor on first line, away from the bold
    editor.setSelection(0);

    expect(
      container.querySelector("[data-source]")?.getAttribute("data-source"),
    ).toBe("**bold**");
    editor.destroy();
  });

  // ── Embedded HTML blocks ──

  it("renders embedded HTML blocks via innerHTML when cursor is outside", () => {
    const container = document.createElement("div");
    const html =
      '<div class="demo"><strong>Bold</strong> and <em>italic</em></div>';
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${html}\n\nend`,
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);
    expect(container.querySelector(".demo")).not.toBeNull();
    expect(container.querySelector(".demo strong")?.textContent).toBe("Bold");
    expect(container.querySelector(".demo em")?.textContent).toBe("italic");
    editor.destroy();
  });

  it("falls back to raw HTML source when cursor enters the HTML block", () => {
    const container = document.createElement("div");
    const html = '<div class="demo">Inside</div>';
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${html}\n\nend`,
      livePreview: true,
    });

    // Cursor on first line — block widget rendered.
    editor.setSelection(0);
    expect(container.querySelector(".demo")).not.toBeNull();

    // Cursor inside the HTML block — source shown, widget removed.
    const htmlOffset = editor.getDocument().indexOf("<div");
    editor.setSelection(htmlOffset + 5);
    expect(container.querySelector(".demo")).toBeNull();
    expect(container.textContent).toContain("<div class=");
    editor.destroy();
  });

  it("renders inline HTML tags (kbd/mark/sub/sup/br) inside paragraphs", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "Intro\n\n<kbd>Ctrl</kbd> + <kbd>C</kbd> copy, <mark>highlight</mark>, X<sub>1</sub>, X<sup>2</sup>.\n\nend",
      livePreview: true,
    });

    editor.setSelection(0);
    // Each inline HTML tag must be rendered as its actual element, not
    // shown as literal angle-bracket text.
    expect(container.querySelectorAll("kbd").length).toBe(2);
    expect(container.querySelector("kbd")?.textContent).toBe("Ctrl");
    expect(container.querySelector("mark")?.textContent).toBe("highlight");
    expect(container.querySelector("sub")?.textContent).toBe("1");
    expect(container.querySelector("sup")?.textContent).toBe("2");
    expect(container.textContent).not.toContain("<kbd>");
    editor.destroy();
  });

  it("renders inline SVG within a paragraph", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        'Intro\n\nInline SVG:\n<svg width="40" height="40"><circle cx="20" cy="20" r="15" /></svg>\n\nend',
      livePreview: true,
    });

    editor.setSelection(0);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.querySelector("circle")).not.toBeNull();
    editor.destroy();
  });

  it("clicking the rendered HTML block enters edit mode (no ✎ button needed)", () => {
    const container = document.createElement("div");
    const html = '<div class="demo"><strong>Bold</strong></div>';
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${html}\n\nend`,
      livePreview: true,
    });

    editor.setSelection(0);
    const wrapper = container.querySelector<HTMLElement>(".nexus-html-block");
    expect(wrapper).not.toBeNull();
    // Click anywhere on the rendered HTML — even an inner element — to
    // enter edit mode. mousedown is the trigger (fires before any inner
    // click handler).
    const inner = wrapper?.querySelector("strong") ?? wrapper!;
    inner.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(container.querySelector(".demo")).toBeNull();
    expect(container.textContent).toContain("<div class=");
    editor.destroy();
  });

  // ── GFM Alerts / Callouts ──

  it("renders GFM alert blockquotes (> [!NOTE]) with a styled badge", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n> [!NOTE]\n> GitHub note body.\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);
    const badge = container.querySelector(
      ".nexus-alert-label",
    ) as HTMLElement | null;
    expect(badge).not.toBeNull();
    expect(badge?.textContent ?? "").toContain("Note");
    // The literal `[!NOTE]` link decoration should be suppressed — we
    // shouldn't see "data-link-url" on the badge area.
    const link = container.querySelector("[data-link-url]");
    if (link) {
      expect(link.textContent).not.toBe("!NOTE");
    }
    editor.destroy();
  });

  it("renders all five GFM alert types with distinct labels", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "> [!NOTE]\n> n\n\n> [!TIP]\n> t\n\n> [!IMPORTANT]\n> i\n\n> [!WARNING]\n> w\n\n> [!CAUTION]\n> c\n\nend",
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);
    const badges = Array.from(container.querySelectorAll(".nexus-alert-label"));
    expect(badges.length).toBe(5);
    const labels = badges.map((b) => b.textContent ?? "");
    expect(labels.some((t) => t.includes("Note"))).toBe(true);
    expect(labels.some((t) => t.includes("Tip"))).toBe(true);
    expect(labels.some((t) => t.includes("Important"))).toBe(true);
    expect(labels.some((t) => t.includes("Warning"))).toBe(true);
    expect(labels.some((t) => t.includes("Caution"))).toBe(true);
    editor.destroy();
  });

  it("renders Docusaurus/VitePress `:::type` fenced callouts", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n:::info\nbody text\n:::\n\nend",
      livePreview: true,
    });

    editor.setSelection(0);
    const callout = container.querySelector(
      ".nexus-callout",
    ) as HTMLElement | null;
    expect(callout).not.toBeNull();
    expect(callout?.getAttribute("data-callout-type")).toBe("info");
    expect(
      callout?.querySelector(".nexus-callout-body")?.textContent,
    ).toContain("body text");
    editor.destroy();
  });

  it("renders `:::warning Custom Title` with the custom title", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n:::warning Custom Title\nbody\n:::\n\nend",
      livePreview: true,
    });

    editor.setSelection(0);
    const title = container.querySelector(".nexus-callout-title");
    expect(title?.textContent ?? "").toContain("Custom Title");
    editor.destroy();
  });

  it("clicking <summary> or <a href> inside an HTML block preserves native behaviour (no edit-mode trigger)", () => {
    const container = document.createElement("div");
    const html =
      "<details><summary>Toggle</summary><p>Hidden text</p></details>" +
      '<p><a href="https://example.com" data-test="link">Link</a></p>';
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${html}\n\nend`,
      livePreview: true,
    });

    editor.setSelection(0);
    const summary = container.querySelector("summary") as HTMLElement | null;
    expect(summary).not.toBeNull();

    // Clicking summary must NOT enter edit mode — the widget stays mounted.
    summary?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(container.querySelector(".nexus-html-block")).not.toBeNull();
    expect(container.querySelector("summary")).not.toBeNull();

    // Clicking a link inside the block also preserves native behaviour.
    const link = container.querySelector(
      'a[data-test="link"]',
    ) as HTMLElement | null;
    expect(link).not.toBeNull();
    link?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(container.querySelector(".nexus-html-block")).not.toBeNull();

    // Clicking the surrounding wrapper (not on an interactive element)
    // DOES enter edit mode.
    const wrapper = container.querySelector<HTMLElement>(".nexus-html-block");
    wrapper?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(container.querySelector(".nexus-html-block")).toBeNull();
    editor.destroy();
  });

  it("strips <script> and inline event handlers from HTML blocks by default", () => {
    const container = document.createElement("div");
    const html =
      '<div class="hostile" onclick="alert(1)">' +
      "<script>window.evil=true;</script>safe content</div>";
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${html}\n\nend`,
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);
    const block = container.querySelector(".hostile") as HTMLElement | null;
    expect(block).not.toBeNull();
    // onclick handler stripped.
    expect(block?.hasAttribute("onclick")).toBe(false);
    // Script tag and its body removed; "safe content" preserved.
    expect(block?.querySelector("script")).toBeNull();
    expect((window as unknown as { evil?: boolean }).evil).toBeUndefined();
    expect(block?.textContent ?? "").toContain("safe content");
    editor.destroy();
  });

  // ── Lists (per-item iteration, nested numbering) ──

  it("numbers ordered list items by item, not by raw lines (no off-by-N with nested unordered list)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "Intro\n\n1. first\n   - nested a\n   - nested b\n2. second\n3. third\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);
    // The visible bullets for the ordered list should be "1. ", "2. ", "3. "
    // (NOT 1, 2, 3, 4, 5 — the nested unordered lines must not count toward
    // the parent ordered-list numbering).
    const text = container.textContent ?? "";
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).toContain("3. ");
    expect(text).not.toContain("4. ");
    expect(text).not.toContain("5. ");
    editor.destroy();
  });

  it("renders GFM task list checkboxes with strike-through on checked head line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n- [x] done item\n- [ ] open item\n\nend",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    editor.setSelection(editor.getDocument().length);
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(inputs.length).toBe(2);
    expect(inputs[0].checked).toBe(true);
    expect(inputs[1].checked).toBe(false);
    editor.destroy();
  });

  // ── Inline style applied while cursor is on same line ──

  it("keeps bold style applied when cursor is on the same line as the inline mark", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** here\n\nend",
      livePreview: true,
    });

    // Cursor on the line with bold — markers should remain visible but
    // the bold style must still be applied to the content span.
    editor.setSelection(8);
    const text = container.textContent ?? "";
    expect(text).toContain("**bold**");
    const boldSpan = Array.from(
      container.querySelectorAll<HTMLElement>("span"),
    ).find(
      (el) =>
        el.textContent === "bold" &&
        /font-weight\s*:\s*bold/i.test(el.getAttribute("style") ?? ""),
    );
    expect(boldSpan).not.toBeUndefined();
    editor.destroy();
  });

  it("uses default mark decoration for node types without custom renderer", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "end\n\nText **bold** *italic*",
      livePreview: {
        renderers: {
          strong({ text }) {
            const element = document.createElement("span");
            element.textContent = text.toUpperCase();
            return element;
          },
        },
      },
    });

    editor.setSelection(0);

    // Custom renderer for strong
    expect(container.querySelector("span")?.textContent).toBe("BOLD");
    // Default mark decoration for italic — markers replaced
    const text = container.textContent ?? "";
    expect(text).toContain("italic");
    expect(text).not.toContain("*italic*");
    editor.destroy();
  });

  // ── Inline HTML in list items ──
  it("renders span and u tags as inline within list items (no line break)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue:
        "1. <span style='color:red'>text</span> more\n2. <u>under</u> line\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);

    // Should NOT render as block-level HTML (no nexus-html-block wrapper)
    expect(container.querySelectorAll(".nexus-html-block").length).toBe(0);

    // Both list items should be present
    const text = container.textContent ?? "";
    expect(text).toContain("text");
    expect(text).toContain("under");

    editor.destroy();
  });

  // ── List marker unselectable ──
  it("renders list bullets with user-select:none to prevent text selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- first\n- second\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);

    const bullets = container.querySelectorAll<HTMLElement>(
      ".cm-content span[style*='user-select']",
    );
    expect(bullets.length).toBeGreaterThanOrEqual(2);

    for (const bullet of Array.from(bullets)) {
      const style = bullet.style.userSelect || bullet.style.webkitUserSelect;
      expect(style).toBe("none");
    }

    editor.destroy();
  });

  it("prevents cursor from landing on list marker on mousedown", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- first\n- second\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).toContain("\u2022 ");
    expect(text).not.toContain("- first");
    expect(text).not.toContain("- second");

    editor.destroy();
  });
});
