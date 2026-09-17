import { describe, expect, it, vi } from "vitest";
import { createEditorShell, resolveImageSrc } from "../src/renderer/editor-shell";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";

describe("createEditorShell", () => {
  it("does not mint unmanaged nexus-vault URLs for legacy image paths", () => {
    expect(resolveImageSrc("attachments/photo one.png")).toBe("attachments/photo one.png");
    expect(resolveImageSrc("https://example.com/photo.png")).toBe("https://example.com/photo.png");
  });

  it("creates a core editor in the given container", () => {
    const container = document.createElement("div");
    const state = createState();
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelectorAll(".nexus-block-drag")).toHaveLength(1);
    shell.destroy();
  });

  it("moves blocks through the legacy keyboard binding and supports undo", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const state = createState();
    state.content = "first\n\nsecond";
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown", altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    container.querySelector(".cm-content")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shell.editor.getDocument()).toBe("second\n\nfirst");
    expect(shell.editor.undo()).toBe(true);
    expect(shell.editor.getDocument()).toBe("first\n\nsecond");
    shell.destroy();
    container.remove();
  });

  it("marks state dirty when the editor content changes", async () => {
    const container = document.createElement("div");
    const state = createState();
    const onChange = vi.fn();
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: onChange,
    });

    shell.editor.setDocument("new content");
    // onChange is debounced (parseDelayMs 150); give it a moment to fire.
    await new Promise((r) => setTimeout(r, 200));

    expect(state.dirty).toBe(true);
    expect(state.content).toBe("new content");
    expect(onChange).toHaveBeenCalled();
    shell.destroy();
  });

  it("resets dirty flag when loadDocument is called", async () => {
    const container = document.createElement("div");
    const state = createState();
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    shell.editor.setDocument("edited");
    await new Promise((r) => setTimeout(r, 200));
    expect(state.dirty).toBe(true);

    shell.loadDocument("loaded from file");
    expect(state.dirty).toBe(false);
    expect(state.content).toBe("loaded from file");
    expect(shell.editor.getDocument()).toBe("loaded from file");
    shell.destroy();
  });

  it("leaves migrated UI to the runtime owner in runtime mode", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const shell = createEditorShell({
      container,
      state: createState(),
      settings: defaultSettings(),
      contributionMode: "runtime",
      onStateChange: vi.fn(),
    });

    expect(shell.toolbar).toBeNull();
    expect(shell.slashMenu).toBeNull();
    expect(shell.wordcount).toBeNull();
    expect(container.querySelectorAll(".nexus-toolbar")).toHaveLength(0);
    expect(container.querySelectorAll(".nexus-block-drag")).toHaveLength(0);
    expect(document.body.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='nexus-wordcount-bar']")).toHaveLength(0);

    shell.destroy();
    container.remove();
  });
});
