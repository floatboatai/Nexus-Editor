import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createToolbarPlugin } from "../src/index";

describe("color decoration offset regression", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  const setupEditor = (html: string) => {
    const initialValue = html + "\ncursor-target";
    editor = createEditor({
      container,
      initialValue,
      plugins: [createToolbarPlugin()]
    });
    editor.setSelection(initialValue.length);
  };

  describe("span color cases", () => {
    it.each([
      ["canonical control", `<span style="color:red">hello</span>`, "red"],
      ["whitespace after colon", `<span style="color: red">hello</span>`, "red"],
      ["multiple spaces before style", `<span   style="color:red">hello</span>`, "red"]
    ])("%s", (name, html, expectedColor) => {
      setupEditor(html);

      const lines = container.querySelectorAll(".cm-line");
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const line = lines[0];

      const styledSpan = Array.from(line.querySelectorAll<HTMLElement>("span")).find(
        el => el.style.color !== ""
      );
      expect(styledSpan).not.toBeUndefined();

      expect(styledSpan!.style.color).toBe(expectedColor);
      expect(line.textContent).toBe("hello");
    });
  });

  describe("highlight mark cases", () => {
    it.each([
      ["highlight", `<mark style="background: #ffff00">hello</mark>`, "rgb(255, 255, 0)"]
    ])("%s", (name, html, expectedBg) => {
      setupEditor(html);

      const lines = container.querySelectorAll(".cm-line");
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const line = lines[0];

      const styledEl = Array.from(line.querySelectorAll<HTMLElement>("span, mark")).find(
        el => el.style.backgroundColor !== "" || el.style.background !== ""
      );
      expect(styledEl).not.toBeUndefined();

      expect(styledEl!.style.backgroundColor).toBe(expectedBg);
      expect(line.textContent).toBe("hello");
    });
  });
});
