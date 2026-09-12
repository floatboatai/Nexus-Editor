import { describe, expect, it } from "vitest";

import { createEditor } from "../src/index";
import { createGfmPreset } from "../../preset-gfm/src/index";

describe("accessibility", () => {
  it("headings have role=heading and aria-level", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Title\n\n## Sub",
      livePreview: true
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
      livePreview: true
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
      plugins: [createGfmPreset()]
    });

    const table = container.querySelector("table[role='grid']");
    expect(table).not.toBeNull();
    expect(table?.getAttribute("aria-label")).toBe("Editable table");
    editor.destroy();
  });

  it("exposes table rows, cells, and keyboard reorder grips to assistive technology", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| Name | Status |\n| --- | --- |\n| Alpha | Done |",
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    const table = container.querySelector("table[role='grid']");
    expect(table?.getAttribute("aria-multiselectable")).toBe("true");
    expect(table?.getAttribute("aria-rowcount")).toBe("3");
    expect(table?.getAttribute("aria-colcount")).toBe("3");

    const rows = Array.from(table?.querySelectorAll<HTMLElement>("[role='row']") ?? []);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3"]);

    const headerCells = rows[1].querySelectorAll<HTMLElement>("[role='columnheader'].nexus-cell");
    expect(Array.from(headerCells).map((cell) => cell.textContent)).toEqual(["Name", "Status"]);
    expect(Array.from(headerCells).map((cell) => cell.getAttribute("aria-colindex"))).toEqual(["2", "3"]);

    const bodyCells = rows[2].querySelectorAll<HTMLElement>("[role='gridcell']");
    expect(Array.from(bodyCells).map((cell) => cell.textContent)).toEqual(["Alpha", "Done"]);

    const columnGrip = table?.querySelector<HTMLButtonElement>(".nexus-col-grip .nexus-grip-button");
    const rowGrip = table?.querySelector<HTMLButtonElement>(".nexus-row-grip .nexus-grip-button");
    expect(columnGrip?.getAttribute("aria-label")).toBe(
      "Column 1 grip. Use Left and Right Arrow keys to reorder."
    );
    expect(columnGrip?.getAttribute("aria-keyshortcuts")).toBe("ArrowLeft ArrowRight");
    expect(rowGrip?.getAttribute("aria-label")).toBe(
      "Row 1 grip. Use Up and Down Arrow keys to reorder."
    );
    expect(rowGrip?.getAttribute("aria-keyshortcuts")).toBe("ArrowUp ArrowDown");

    editor.destroy();
  });
});
