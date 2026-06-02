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
      plugins: [createHistoryPlugin()],
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
        cancelable: true,
      }),
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
      livePreview: true,
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

  // Code block lines must not set font-family or font-size on Decoration.line —
  // only on Decoration.mark. Otherwise CM6's heightmap sees different line heights
  // for code vs regular lines, causing cumulative click drift in long documents.
  it("code block Decoration.line does not set font-family/font-size (keeps heightmap uniform)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nmore",
      livePreview: true,
    });

    // Code lines have background on the line element (Decoration.line)
    const bgLines = Array.from(container.querySelectorAll(".cm-line")).filter((line) =>
      (line as HTMLElement).getAttribute("style")?.includes("background"),
    );
    expect(bgLines.length).toBeGreaterThanOrEqual(2);
    for (const line of bgLines) {
      const style = line.getAttribute("style") ?? "";
      expect(style).not.toMatch(/font-family\s*:/);
      expect(style).not.toMatch(/font-size\s*:/);
    }
    // Monospace is on child mark spans, not the line itself
    const monoSpans = bgLines.flatMap((line) =>
      Array.from(line.querySelectorAll("span")).filter((span) =>
        span.getAttribute("style")?.includes("monospace"),
      ),
    );
    expect(monoSpans.length).toBeGreaterThan(0);
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
      livePreview: true,
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
      livePreview: true,
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

  // Copy button must be present and stable on every fenced code block, regardless of
  // cursor position. Toggling it would re-create the heightmap instability that the
  // previous ::after-based language label caused (commit b2f1a31).
  it("fenced code block renders a copy button in the first fence line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\n```\n\nend",
      livePreview: true,
    });

    editor.setSelection(0);
    const btnOff = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Copy code",
    );
    expect(btnOff).toBeDefined();

    // Cursor inside code block — button still there
    editor.setSelection(10);
    const btnOn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Copy code",
    );
    expect(btnOn).toBeDefined();
    editor.destroy();
  });

  // Button label surfaces the language tag (```python → "python", ``` → "Copy").
  it("copy button label shows the language, or 'Copy' when no language is set", () => {
    const withLang = document.createElement("div");
    const editorA = createEditor({
      container: withLang,
      initialValue: "```python\nprint(1)\n```",
      livePreview: true,
    });
    const btnA = Array.from(withLang.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Copy code",
    );
    expect(btnA?.textContent).toBe("python");
    editorA.destroy();

    const noLang = document.createElement("div");
    const editorB = createEditor({
      container: noLang,
      initialValue: "```\njust text\n```",
      livePreview: true,
    });
    const btnB = Array.from(noLang.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Copy code",
    );
    expect(btnB?.textContent).toBe("Copy");
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
      livePreview: true,
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
});
