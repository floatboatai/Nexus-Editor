import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";

import { createMathPlugin } from "../src/index";

describe("math plugin widgets", () => {
  it("renders block math as a widget", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n$$\nx^2\n$$",
      plugins: [createMathPlugin()],
    });

    // Cursor in "Intro", outside the math source range.
    editor.setSelection(0);

    expect(container.querySelector("[data-nexus-widget='math']")).not.toBeNull();
    expect(container.querySelector(".nexus-math-display")).not.toBeNull();
    editor.destroy();
  });

  it("renders inline math inline, sharing its line with surrounding text", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Before $x$ after",
      plugins: [createMathPlugin()],
    });

    editor.setSelection(0);

    const widget = container.querySelector<HTMLElement>(
      "[data-nexus-widget='inlineMath']"
    );
    expect(widget).not.toBeNull();
    // Inline widget shares its cm-line with the surrounding "after" text.
    const line = widget?.closest(".cm-line") as HTMLElement | null;
    expect(line?.textContent ?? "").toContain("after");
    editor.destroy();
  });

  it("reveals raw Markdown when the block edit affordance is clicked", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n$$\nx^2\n$$",
      plugins: [createMathPlugin()],
    });

    editor.setSelection(0);
    expect(container.querySelector("[data-nexus-widget='math']")).not.toBeNull();

    const editBtn = container.querySelector<HTMLElement>(
      "button[title='Edit formula']"
    );
    expect(editBtn).not.toBeNull();
    // Exercise the full pointer sequence — the button has a mousedown guard
    // (preventDefault/stopPropagation) the real interaction path relies on.
    editBtn?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    editBtn?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    // enterEditMode() moved the selection into the source range → raw source.
    expect(container.querySelector("[data-nexus-widget='math']")).toBeNull();
    expect(container.textContent).toContain("$$");
    editor.destroy();
  });
});
