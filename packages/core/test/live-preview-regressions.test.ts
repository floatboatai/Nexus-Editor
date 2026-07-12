import { describe, expect, it, vi } from "vitest";

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
  it("code block Decoration.line does not set font-family/font-size (keeps heightmap uniform)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nmore",
      livePreview: true
    });

    // Code lines have background on the line element (Decoration.line)
    const bgLines = Array.from(container.querySelectorAll(".cm-line")).filter(
      (line) => (line as HTMLElement).getAttribute("style")?.includes("background")
    );
    expect(bgLines.length).toBeGreaterThanOrEqual(2);
    for (const line of bgLines) {
      const style = line.getAttribute("style") ?? "";
      expect(style).not.toMatch(/font-family\s*:/);
      expect(style).not.toMatch(/font-size\s*:/);
    }
    // Monospace is on child mark spans, not the line itself
    const monoSpans = bgLines.flatMap((line) =>
      Array.from(line.querySelectorAll("span")).filter(
        (span) => span.getAttribute("style")?.includes("monospace")
      )
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

  // Copy button must be present and stable on every fenced code block, regardless of
  // cursor position. Toggling it would re-create the heightmap instability that the
  // previous ::after-based language label caused (commit b2f1a31).
  it("fenced code block renders a copy button in the first fence line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1;\n```\n\nend",
      livePreview: true
    });

    editor.setSelection(0);
    const btnOff = Array.from(container.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-label") === "Copy code");
    expect(btnOff).toBeDefined();

    // Cursor inside code block — button still there
    editor.setSelection(10);
    const btnOn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-label") === "Copy code");
    expect(btnOn).toBeDefined();
    editor.destroy();
  });

  // Button label surfaces the language tag (```python → "python", ``` → "Copy").
  it("copy button label shows the language, or 'Copy' when no language is set", () => {
    const withLang = document.createElement("div");
    const editorA = createEditor({
      container: withLang,
      initialValue: "```python\nprint(1)\n```",
      livePreview: true
    });
    const btnA = Array.from(withLang.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-label") === "Copy code");
    expect(btnA?.textContent).toBe("python");
    editorA.destroy();

    const noLang = document.createElement("div");
    const editorB = createEditor({
      container: noLang,
      initialValue: "```\njust text\n```",
      livePreview: true
    });
    const btnB = Array.from(noLang.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-label") === "Copy code");
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

  // Linked images `[![alt](img)](url)` — e.g. README CI badges. The old
  // regex-driven image scan emitted a replace decoration nested inside the
  // link's replace decoration, and the link's marker arithmetic split at the
  // FIRST `](` (inside the nested image), so the label rendered as garbage
  // like `![logo` with a fragment URL.
  it("renders a linked image as a clickable image widget", () => {
    const container = document.createElement("div");
    const doc = "Intro\n\n[![logo](https://example.com/l.png)](https://example.com)\n\nend";
    const editor = createEditor({
      container,
      initialValue: doc,
      livePreview: true
    });

    editor.setSelection(0);
    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    const img = linkEl?.querySelector("[data-live-preview-image]");
    expect(img?.getAttribute("data-live-preview-image")).toBe("https://example.com/l.png");
    // Hovering must reveal the destination, including on the <img> itself.
    expect(linkEl?.getAttribute("title")).toBe("https://example.com");
    expect(linkEl?.querySelector("img")?.title).toBe("https://example.com");
    // No half-parsed label text may leak through.
    expect(container.textContent).not.toContain("![logo");

    // Cursor inside the link → raw source visible for editing AND the
    // preview rendered alongside (same contract as standalone images), so
    // pasting a badge line shows the result without moving the cursor.
    editor.setSelection(doc.indexOf("logo"));
    expect(container.textContent).toContain("[![logo](https://example.com/l.png)](https://example.com)");
    const editModePreview = container.querySelector("[data-link-url]");
    expect(editModePreview?.querySelector("[data-live-preview-image]")).not.toBeNull();

    // Cursor at the very end of the link (where it lands right after a
    // paste) also counts as "on the link" — preview must still be visible,
    // and exactly ONE: the child image range must not add its own preview
    // on top of the link's (parentSpans suppression).
    editor.setSelection(doc.indexOf("\n\nend"));
    expect(container.querySelectorAll("[data-live-preview-image]").length).toBe(1);

    // Cursor back out → widget again.
    editor.setSelection(0);
    expect(container.querySelector("[data-link-url]")).not.toBeNull();
    expect(container.textContent).not.toContain("![logo");
    editor.destroy();
  });

  // Navigation runs through a CM6 domEventHandler, and CM6 skips ALL of
  // those for events inside widgets whose ignoreEvent() returns true. The
  // rendered DOM is byte-identical either way, so only a dispatched event
  // catches a regression back to a swallowing widget.
  it("mousedown on a linked-image widget opens the destination", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const doc = "Intro\n\n[![logo](https://example.com/l.png)](https://example.com)\n\nend";
    const editor = createEditor({ container, initialValue: doc, livePreview: true });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    editor.setSelection(0);
    const img = container.querySelector("[data-link-url] img");
    expect(img).not.toBeNull();
    img?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");

    open.mockRestore();
    editor.destroy();
    container.remove();
  });

  // data-link-url is authored document content — non-web schemes must be
  // consumed without reaching window.open, and scheme-less GFM autolink
  // literals must not be opened as relative paths.
  it("filters link destinations by scheme before opening", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const doc = "Intro\n\n[run](javascript:alert(1)) and www.example.com\n\nend";
    const editor = createEditor({ container, initialValue: doc, livePreview: true });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    editor.setSelection(0);
    const links = Array.from(container.querySelectorAll("[data-link-url]"));
    const jsLink = links.find((el) => el.getAttribute("data-link-url")?.startsWith("javascript:"));
    expect(jsLink).toBeDefined();
    jsLink?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(open).not.toHaveBeenCalled();

    const wwwLink = links.find((el) => el.getAttribute("data-link-url") === "www.example.com");
    expect(wwwLink).toBeDefined();
    wwwLink?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(open).toHaveBeenCalledWith("https://www.example.com", "_blank", "noopener");

    open.mockRestore();
    editor.destroy();
    container.remove();
  });

  // Labels mixing text and several images must render every image inside a
  // single navigable widget (the untested else-branch of the label walk).
  it("renders a mixed text-and-images label as one clickable widget", () => {
    const container = document.createElement("div");
    const doc =
      "Intro\n\n[pre ![a](https://example.com/1.png) mid ![b](https://example.com/2.png)](https://example.com)\n\nend";
    const editor = createEditor({ container, initialValue: doc, livePreview: true });

    editor.setSelection(0);
    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    expect(linkEl?.querySelectorAll("[data-live-preview-image]").length).toBe(2);
    expect(linkEl?.textContent).toContain("pre");
    expect(linkEl?.textContent).toContain("mid");
    editor.destroy();
  });

  // The image may sit deeper than the label's top level — `[*![a](i)*](u)`
  // wraps it in emphasis. A direct-children-only check fell back to the
  // marker-arithmetic path, which splits at the FIRST "](" and produced the
  // same garbage label/URL the widget branch exists to prevent.
  it("renders a linked image whose label nests the image inside emphasis", () => {
    const container = document.createElement("div");
    const doc = "Intro\n\n[*![logo](https://example.com/l.png)* extra](https://example.com)\n\nend";
    const editor = createEditor({ container, initialValue: doc, livePreview: true });

    editor.setSelection(0);
    const linkEl = container.querySelector("[data-link-url]");
    expect(linkEl?.getAttribute("data-link-url")).toBe("https://example.com");
    expect(linkEl?.querySelector("[data-live-preview-image]")?.getAttribute("data-live-preview-image")).toBe(
      "https://example.com/l.png"
    );
    expect(linkEl?.textContent).toContain("extra");
    expect(container.textContent).not.toContain("![logo");
    editor.destroy();
  });

  // Reference-style links have no inline destination. The adapter used to
  // fall back to the whole node source, so `[![a](i)][ref]` rendered a
  // "clickable" image whose data-link-url and hover tooltip were the raw
  // markdown itself.
  it("renders a reference-style linked image without a fake destination", () => {
    const container = document.createElement("div");
    const doc = "Intro\n\n[![logo](https://example.com/l.png)][badge]\n\n[badge]: https://example.com\n\nend";
    const editor = createEditor({ container, initialValue: doc, livePreview: true });

    editor.setSelection(0);
    expect(container.querySelector("[data-live-preview-image]")).not.toBeNull();
    expect(container.querySelector("[data-link-url]")).toBeNull();
    expect(container.textContent).not.toContain("[![logo");
    editor.destroy();
  });

  // Code contexts are literal text: the document-wide image regex used to
  // inject real image widgets into fenced code blocks and inline code.
  it("keeps image syntax literal inside fenced code and inline code", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "```\n![alt](https://example.com/a.png)\n```\n\nUse `![x](https://example.com/b.png)` inline\n\nend",
      livePreview: true
    });

    editor.setSelection(editor.getDocument().length);
    expect(container.querySelector("[data-live-preview-image]")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("![alt](https://example.com/a.png)");
    expect(text).toContain("![x](https://example.com/b.png)");
    editor.destroy();
  });

  // CommonMark allows balanced parentheses in destinations; the old regex
  // stopped at the first `)`, truncating the URL and leaving a stray `)`.
  it("renders image URLs containing balanced parentheses in full", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n![Wiki](https://en.wikipedia.org/wiki/Foo_(bar))\n\nend",
      livePreview: true
    });

    editor.setSelection(0);
    const widget = container.querySelector("[data-live-preview-image]");
    expect(widget?.getAttribute("data-live-preview-image")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)"
    );
    // The truncated match used to leave the final ")" behind as stray
    // document text on the image's line.
    expect(widget?.closest(".cm-line")?.textContent).not.toContain(")");
    editor.destroy();
  });
});
