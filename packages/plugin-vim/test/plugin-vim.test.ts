import { type EditorAPI, createEditor } from "@floatboat/nexus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVimPlugin } from "../src/index";

describe("plugin-vim", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  it("should load without errors", () => {
    editor = createEditor({
      container,
      plugins: [createVimPlugin()],
    });
    expect(editor.getDocument()).toBe("");
  });

  it("should allow normal editing", () => {
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createVimPlugin()],
    });
    expect(editor.getDocument()).toBe("hello");
  });
});
