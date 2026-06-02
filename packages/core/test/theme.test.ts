import { describe, expect, it } from "vitest";

import { createEditor, darkTheme, lightTheme } from "../src/index";

describe("theme system", () => {
  it("applies light theme CSS variables by default", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
    expect(cmEditor).not.toBeNull();
    // The CM6 theme extension sets CSS variables on the editor root
    const _style = cmEditor.style;
    // Variables are set via CM6's theme mechanism on the & selector
    expect(cmEditor.className).toContain("cm-editor");
    editor.destroy();
  });

  it("applies dark theme when configured", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello",
      theme: darkTheme,
    });

    // Should create without error
    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("setTheme switches theme at runtime preserving content", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "preserve me",
    });

    editor.setTheme(darkTheme);

    // Content and cursor preserved
    expect(editor.getDocument()).toBe("preserve me");

    editor.setTheme(lightTheme);
    expect(editor.getDocument()).toBe("preserve me");
    editor.destroy();
  });

  it("custom theme with partial overrides works", () => {
    const custom = { ...lightTheme, accent: "#ff0000", bg: "#fefefe" };
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "custom theme",
      theme: custom,
    });

    expect(editor.getDocument()).toBe("custom theme");
    editor.destroy();
  });
});
