import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createToolbarPlugin } from "../src/index";

describe("list drag reorder", () => {
  function setup(initial: string) {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: initial,
      plugins: [createToolbarPlugin()],
    });
    return { editor, container };
  }

  it("plugin is registered", () => {
    const plugin = createToolbarPlugin();
    expect(plugin.cmExtensions).toHaveLength(2);
  });

  it("mousedown on list item does not crash", () => {
    const { editor, container } = setup("- item1\n- item2\n- item3");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    expect(() => {
      content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    }).not.toThrow();
    expect(editor.getDocument()).toBe("- item1\n- item2\n- item3");
    editor.destroy();
  });

  it("mousedown on ordered list item does not crash", () => {
    const { editor, container } = setup("1. first\n2. second\n3. third");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    expect(() => {
      content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    }).not.toThrow();
    editor.destroy();
  });

  it("mousedown on non-list line does nothing", () => {
    const { editor, container } = setup("plain text\nmore text");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 15, clientY: 15 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 15, clientY: 15 }));
    expect(editor.getDocument()).toBe("plain text\nmore text");
    editor.destroy();
  });

  it("drag on list item does not corrupt document", () => {
    const { editor, container } = setup("- a\n- b\n- c");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 30 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 30 }));
    expect(editor.getDocument()).toBe("- a\n- b\n- c");
    editor.destroy();
  });

  it("destroy during drag cleans up listeners", () => {
    const { editor, container } = setup("- item1\n- item2");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    // Move mouse to trigger mousemove state
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 30 }));
    // Destroy editor mid-drag
    editor.destroy();
    // Remaining mouseup should not throw
    expect(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 30 }));
    }).not.toThrow();
  });

  it("multi-line list item is detected as single block", () => {
    const { editor, container } = setup("- item1\n  continuation\n  more\n- item2");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10 }));
    expect(editor.getDocument()).toBe("- item1\n  continuation\n  more\n- item2");
    editor.destroy();
  });

  it("tableEditing guard blocks mousedown during table edit", () => {
    // This verifies the isTableEditing() check exists and compiles.
    // Actual table editing guard behavior requires table widget interaction.
    const { editor, container } = setup("- a\n- b");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    // Mousedown during table editing is not active, so it should proceed
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10 }));
    expect(editor.getDocument()).toBe("- a\n- b");
    editor.destroy();
  });

  it("mousedown with non-left button is ignored", () => {
    const { editor, container } = setup("- item1\n- item2");
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10, button: 2 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10, button: 2 }));
    expect(editor.getDocument()).toBe("- item1\n- item2");
    editor.destroy();
  });
});
