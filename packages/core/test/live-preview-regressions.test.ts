import { describe, expect, it } from "vitest";

import { createHistoryPlugin } from "../../plugin-history/src/index";
import { createEditor } from "../src/index";

describe("live preview regressions", () => {
  it("keeps live preview working when the history plugin is registered", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**\n\nend",
      livePreview: true,
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    // Move cursor away from the bold line
    editor.setSelection(editor.getDocument().length);

    editor.setDocument("Text **changed**\n\nend");
    editor.setSelection(editor.getDocument().length);

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    // Cursor on different line → markers hidden
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("bold");
    expect(text).not.toContain("**");
    editor.destroy();
  });

  it("restores preview after the cursor leaves a markdown range", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** end\n\nother line",
      livePreview: true
    });

    // Cursor on bold line: raw markdown visible
    editor.setSelection(8);
    expect(container.textContent).toContain("**bold**");

    // Cursor moves to different line: markers hidden
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("bold");
    expect(text).not.toContain("**");
    editor.destroy();
  });

  // Multi-cursor: every selection range is a reveal trigger. Guards the
  // `.some()`-across-ranges reveal logic against a future "main range only"
  // optimisation regression (openspec: add-core-multi-cursor).
  it("reveals raw markers at every cursor with multi-cursor selections", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold** end\n\nother **also** line",
      livePreview: true,
      multiCursor: true
    });

    // One cursor inside each bold span (different lines): both reveal
    editor.setSelections([{ anchor: 8 }, { anchor: 28 }]);
    const revealed = container.textContent ?? "";
    expect(revealed).toContain("**bold**");
    expect(revealed).toContain("**also**");

    // Collapse to a single cursor on the blank line between them: both hide
    editor.setSelection(18);
    const hidden = container.textContent ?? "";
    expect(hidden).toContain("bold");
    expect(hidden).toContain("also");
    expect(hidden).not.toContain("**");
    editor.destroy();
  });

  // Code block lines must not set font-family or font-size on Decoration.line —
  // only on Decoration.mark. Otherwise CM6's heightmap sees different line heights
  // for code vs regular lines, causing cumulative click drift in long documents.
  it("code block Decrations.line does not set font-family/font-size (keeps heightmap uniform)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nmore",
      livePreview: true
    });

    // Force edit mode (line decorations) by placing the cursor inside the fence.
    editor.setSelection(12);

    // Edit-mode lines carry the nexus-code-line class from Decoration.line attributes.
    const codeLines = Array.from(
      container.querySelectorAll(".cm-line.nexus-code-line, .cm-line.nexus-code-line--editing, .cm-line")
    ).filter((line) => {
      const el = line as HTMLElement;
      return (
        el.className.includes("nexus-code-line") ||
        (el.getAttribute("style") ?? "").includes("background")
      );
    });
    expect(codeLines.length).toBeGreaterThanOrEqual(2);
    for (const line of codeLines) {
      const style = (line as HTMLElement).getAttribute("style") ?? "";
      // font-family/size must live on marks, never on the line decoration itself
      expect(style).not.toMatch(/font-family\s*:/);
      expect(style).not.toMatch(/font-size\s*:/);
    }
    editor.destroy();
  });

  // Guards against reintroducing cursor-conditional line-collapsing on definitions.
  // HEIGHT:0 ↔ full-height toggling on cursor movement was the largest click-drift
  // source — any cursor transit across a definition line shifted the entire viewport.
  it("definition line count is identical with cursor on/off (no height toggle)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n[ref]: https://example.com\n\nend",
      livePreview: true
    });

    editor.setSelection(0);
    const linesCursorOff = container.querySelectorAll(".cm-line").length;

    // Position cursor inside the definition line
    editor.setSelection(7);
    const linesCursorOn = container.querySelectorAll(".cm-line").length;

    expect(linesCursorOn).toBe(linesCursorOff);
    editor.destroy();
  });

  it("blockquote remains editable instead of being replaced by a block widget", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n> Editable quote\n> second line\n\nend",
      livePreview: true
    });

    editor.setSelection(editor.getDocument().length);
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).toContain("Editable quote");
    expect(container.textContent).not.toContain("> Editable quote");

    editor.setSelection(9);
    expect(container.textContent).toContain("> Editable quote");

    const before = editor.getDocument();
    editor.setSelection(before.indexOf("Editable"), before.indexOf("Editable") + "Editable".length);
    editor.replaceSelection("Edited");
    expect(editor.getDocument()).toContain("> Edited quote");
    editor.destroy();
  });

  // Preview mode replaces the fence with a code-block widget + header toolbar.
  it("fenced code block renders a preview widget with copy action when cursor is outside", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\n```\n\nend",
      livePreview: true
    });

    // Cursor outside → preview widget
    editor.setSelection(0);
    const block = container.querySelector(".nexus-code-block");
    expect(block).not.toBeNull();
    const copyBtn = Array.from(block?.querySelectorAll("button") ?? []).find(
      (b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes("copy")
    );
    expect(copyBtn).toBeDefined();
    expect(copyBtn?.textContent).toBe("Copy");
    expect(block?.querySelector(".nexus-code-block__lang")?.textContent).toBe("js");
    expect(container.textContent).toContain("const a = 1");

    // Cursor inside → edit mode (source fences visible, preview widget gone,
    // compact edit toolbar still available for copy/format).
    editor.setSelection(12);
    expect(container.querySelector(".nexus-code-block")).toBeNull();
    expect(container.querySelector(".nexus-code-block-edit-toolbar")).not.toBeNull();
    expect(container.textContent).toContain("```js");
    editor.destroy();
  });

  it("code block preview shows language label and Copy in the widget toolbar", () => {
    // Leading text keeps the default cursor outside the fence (preview mode).
    const withLang = document.createElement("div");
    const editorA = createEditor({
      container: withLang,
      initialValue: "Intro\n\n```python\nprint(1)\n```\n",
      livePreview: true
    });
    editorA.setSelection(0);
    const blockA = withLang.querySelector(".nexus-code-block");
    expect(blockA).not.toBeNull();
    expect(blockA?.querySelector(".nexus-code-block__lang")?.textContent).toBe("python");
    const btnA = Array.from(blockA?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === "Copy"
    );
    expect(btnA).toBeDefined();
    editorA.destroy();

    const noLang = document.createElement("div");
    const editorB = createEditor({
      container: noLang,
      initialValue: "Intro\n\n```\njust text\n```\n",
      livePreview: true
    });
    editorB.setSelection(0);
    const blockB = noLang.querySelector(".nexus-code-block");
    expect(blockB?.querySelector(".nexus-code-block__lang")?.textContent).toBe("plain");
    editorB.destroy();
  });

  // Image cursor-aware behavior:
  //   * cursor OUT → replace widget (source hidden)
  //   * cursor IN  → source visible (editable) AND a preview widget alongside,
  //                  so the user can edit markdown and see the image simultaneously.
  // Entry to edit mode is driven by the </> button in the custom renderer.
  it("image widget-only when cursor outside; source + preview when inside", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n![alt](https://example.com/img.png)\n\nend",
      livePreview: true
    });

    editor.setSelection(0);
    const widgetOff = container.querySelector("[data-live-preview-image]");
    expect(widgetOff).not.toBeNull();
    expect(container.textContent).not.toContain("![alt]");

    // Cursor inside → source visible AND preview still rendered.
    editor.setSelection(10);
    const widgetOn = container.querySelector("[data-live-preview-image]");
    expect(widgetOn).not.toBeNull();
    expect(container.textContent).toContain("![alt](https://example.com/img.png)");

    // Move cursor back out → only widget, no source.
    editor.setSelection(0);
    const widgetBack = container.querySelector("[data-live-preview-image]");
    expect(widgetBack).not.toBeNull();
    expect(container.textContent).not.toContain("![alt]");
    editor.destroy();
  });

  // Guard against base64 / data-URL images expanding the content area to
  // infinite width. After paste the caret sits at the end of the image span
  // (exclusive), so the compact widget must hide the multi-KB source line.
  it("data-URL image does not expose the raw base64 source when cursor is outside", () => {
    const container = document.createElement("div");
    // ~2KB of base64-looking payload — enough to break layout if rendered raw.
    const payload = "A".repeat(2048);
    const dataUrl = `data:image/png;base64,${payload}`;
    const md = `Intro\n\n![shot](${dataUrl})\n\nafter`;
    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // Cursor outside (default / position 0) → preview widget only.
    editor.setSelection(0);
    const widget = container.querySelector("[data-live-preview-image]");
    expect(widget).not.toBeNull();
    expect(widget?.getAttribute("data-live-preview-image")).toBe(dataUrl);
    // Raw base64 must not leak into the visible text content.
    expect(container.textContent).not.toContain("data:image/png;base64,");
    expect(container.textContent).not.toContain(payload.slice(0, 64));

    // Image element itself is width-capped.
    const img = container.querySelector<HTMLImageElement>("[data-live-preview-image] img, img");
    if (img) {
      expect(img.style.maxWidth === "100%" || getComputedStyle(img).maxWidth !== "none").toBe(true);
    }

    // Soft wrapping is on by default (cm-lineWrapping class on content).
    expect(container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping")).toBe(true);
    editor.destroy();
  });

  it("cursor parked at the end of an image still shows the preview widget (not raw source)", () => {
    const container = document.createElement("div");
    const dataUrl = `data:image/png;base64,${"B".repeat(512)}`;
    const prefix = "Hi\n\n";
    const imageMd = `![x](${dataUrl})`;
    const editor = createEditor({
      container,
      initialValue: `${prefix}${imageMd}\n`,
      livePreview: true,
    });

    // Simulate post-paste caret: right after the closing `)`.
    const endOfImage = prefix.length + imageMd.length;
    editor.setSelection(endOfImage);
    expect(container.querySelector("[data-live-preview-image]")).not.toBeNull();
    expect(container.textContent).not.toContain("data:image/png;base64,");
    editor.destroy();
  });
});
