import { describe, expect, it } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";

describe("accessibility", () => {
  it("headings have role=heading and aria-level", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Title\n\n## Sub",
      livePreview: true,
    });

    const h1 = container.querySelector("[role='heading'][aria-level='1']");
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe("Title");

    const h2 = container.querySelector("[role='heading'][aria-level='2']");
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toBe("Sub");
    editor.destroy();
  });

  it("code blocks have role=code on first line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      livePreview: true,
    });

    // Move cursor into the code block to see editing mode (role=code on first line)
    editor.setSelection(12);
    const codeLine = container.querySelector("[role='code']");
    expect(codeLine).not.toBeNull();
    expect(codeLine?.getAttribute("aria-label")).toBe("Code block: js");
    editor.destroy();
  });

  it("tables have role=grid and aria-label", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const table = container.querySelector("table[role='grid']");
    expect(table).not.toBeNull();
    expect(table?.getAttribute("aria-label")).toBe("Editable table");
    editor.destroy();
  });
});
