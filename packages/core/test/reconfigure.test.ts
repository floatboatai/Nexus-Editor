import { describe, expect, it } from "vitest";

import { createEditor, darkTheme, lightTheme, zhLocale } from "../src/index";

describe("dynamic reconfiguration (Compartments)", () => {
  it("dynamically toggles readOnly state via reconfigure and setReadOnly", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "editable text",
      readOnly: false,
    });

    const content = container.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("contenteditable")).toBe("true");

    // Reconfigure to readOnly
    editor.reconfigure({ readOnly: true });
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(editor.getDocument()).toBe("editable text");

    // Reconfigure back to editable via setReadOnly
    editor.setReadOnly(false);
    expect(content.getAttribute("contenteditable")).toBe("true");
    expect(editor.getDocument()).toBe("editable text");

    editor.destroy();
  });

  it("dynamically updates tabSize via reconfigure and setTabSize", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "tab test",
      tabSize: 4,
    });

    editor.reconfigure({ tabSize: 2 });
    expect(editor.getDocument()).toBe("tab test");

    editor.setTabSize(8);
    expect(editor.getDocument()).toBe("tab test");

    editor.destroy();
  });

  it("dynamically updates text direction via reconfigure and setDirection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "direction test",
      direction: "ltr",
    });

    const content = container.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("dir")).toBeNull();

    editor.reconfigure({ direction: "rtl" });
    expect(content.getAttribute("dir")).toBe("rtl");

    editor.setDirection("ltr");
    expect(content.getAttribute("dir")).toBeNull();

    editor.destroy();
  });

  it("dynamically updates indentGuides via reconfigure and setIndentGuides", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "  indented\n    line",
      indentGuides: false,
    });

    editor.reconfigure({ indentGuides: true });
    expect(editor.getDocument()).toBe("  indented\n    line");

    editor.setIndentGuides(false);
    expect(editor.getDocument()).toBe("  indented\n    line");

    editor.destroy();
  });

  it("dynamically updates theme and locale atomically", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\n\n| Col 1 |\n| --- |\n| Cell |",
      theme: lightTheme,
    });

    editor.reconfigure({
      theme: darkTheme,
      locale: zhLocale,
      readOnly: true,
      direction: "rtl",
    });

    expect(editor.getDocument()).toBe(
      "# Title\n\n| Col 1 |\n| --- |\n| Cell |",
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("dir")).toBe("rtl");

    editor.setLocale({ addColumn: "自定义添加列" });
    expect(editor.getDocument()).toContain("Cell");

    editor.destroy();
  });

  it("preserves selection across reconfigurations", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world sample text",
    });

    editor.setSelection(6, 11);
    expect(editor.getSelection()).toEqual({ anchor: 6, head: 11 });

    editor.reconfigure({
      readOnly: true,
      tabSize: 2,
      theme: darkTheme,
    });

    expect(editor.getSelection()).toEqual({ anchor: 6, head: 11 });
    expect(editor.getSelectedText()).toBe("world");

    editor.destroy();
  });
});
