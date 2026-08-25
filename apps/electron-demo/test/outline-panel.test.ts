import { createEditor } from "@floatboat/nexus-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOutlinePanel } from "../src/renderer/outline-panel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("OutlinePanel visibility lifecycle", () => {
  it("coalesces hidden editor changes into one render on resume", () => {
    const editorContainer = document.createElement("div");
    document.body.append(editorContainer);
    const editor = createEditor({
      container: editorContainer,
      initialValue: "# Initial heading",
    });
    const getTableOfContents = vi.spyOn(editor, "getTableOfContents");
    const panel = createOutlinePanel(editor);
    document.body.append(panel.element);

    expect(getTableOfContents).toHaveBeenCalledOnce();
    expect(panel.element.querySelector("button")?.textContent).toBe("Initial heading");

    panel.setVisible(false);
    getTableOfContents.mockClear();
    for (let index = 0; index < 100; index += 1) {
      editor.setDocument(`# Hidden heading ${index}`);
    }

    expect(getTableOfContents).not.toHaveBeenCalled();
    expect(panel.element.querySelector("button")?.textContent).toBe("Initial heading");

    panel.setVisible(true);
    expect(getTableOfContents).toHaveBeenCalledOnce();
    expect(panel.element.querySelector("button")?.textContent).toBe("Hidden heading 99");

    panel.setVisible(true);
    expect(getTableOfContents).toHaveBeenCalledOnce();

    panel.destroy();
    editor.destroy();
  });

  it("updates while visible and stops observing the editor after destroy", () => {
    const editorContainer = document.createElement("div");
    document.body.append(editorContainer);
    const editor = createEditor({ container: editorContainer, initialValue: "# First" });
    const getTableOfContents = vi.spyOn(editor, "getTableOfContents");
    const panel = createOutlinePanel(editor);

    getTableOfContents.mockClear();
    editor.setDocument("# Second");
    expect(getTableOfContents).toHaveBeenCalledOnce();

    panel.destroy();
    getTableOfContents.mockClear();
    editor.setDocument("# Third");
    panel.update();
    panel.setVisible(false);
    expect(getTableOfContents).not.toHaveBeenCalled();

    panel.destroy();
    editor.destroy();
  });

  it("keeps stable outline DOM while updating heading positions", () => {
    const editorContainer = document.createElement("div");
    document.body.append(editorContainer);
    const editor = createEditor({ container: editorContainer, initialValue: "# Heading" });
    const panel = createOutlinePanel(editor);
    const originalButton = panel.element.querySelector<HTMLButtonElement>("button")!;

    editor.setDocument("prefix\n\n# Heading");

    expect(panel.element.querySelector("button")).toBe(originalButton);
    originalButton.click();
    expect(editor.getSelection()).toEqual({ anchor: 8, head: 8 });

    panel.destroy();
    editor.destroy();
  });
});
