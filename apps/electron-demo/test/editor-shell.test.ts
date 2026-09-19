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
    shell.destroy();
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

  it("loads a document as a fresh undo/redo history boundary", () => {
    const container = document.createElement("div");
    const state = createState();
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    // Opening a file must not become an undo step — otherwise Ctrl+Z before
    // typing anything reverts the loaded buffer back to the empty document.
    shell.loadDocument("opened file");
    expect(shell.editor.undo()).toBe(false);
    expect(shell.editor.getDocument()).toBe("opened file");

    // An edit after the load is undoable, and undo stops at the loaded content.
    shell.editor.setDocument("opened file edited", { history: "record" });
    expect(shell.editor.undo()).toBe(true);
    expect(shell.editor.getDocument()).toBe("opened file");
    expect(shell.editor.redo()).toBe(true);
    expect(shell.editor.getDocument()).toBe("opened file edited");

    // Switching documents must not let the previous file leak back in, in
    // either direction.
    shell.loadDocument("second file");
    expect(shell.editor.undo()).toBe(false);
    expect(shell.editor.redo()).toBe(false);
    expect(shell.editor.getDocument()).toBe("second file");

    shell.destroy();
  });

  it("keeps each shell's undo history isolated from other live editors", () => {
    const firstContainer = document.createElement("div");
    document.body.append(firstContainer);
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);

    const first = createEditorShell({
      container: firstContainer,
      state: createState(),
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });
    const second = createEditorShell({
      container: secondContainer,
      state: createState(),
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    first.loadDocument("first opened file");
    first.editor.setDocument("first opened file edited", { history: "record" });

    // A reset in one shell must not disturb another live shell's stacks. This
    // holds because each editor owns its history compartment; the assertions
    // lock the contract rather than reproducing a known defect.
    second.loadDocument("second opened file");
    second.editor.setDocument("second opened file edited", { history: "record" });
    expect(second.editor.undo()).toBe(true);
    expect(second.editor.getDocument()).toBe("second opened file");
    expect(second.editor.undo()).toBe(false);

    expect(first.editor.undo()).toBe(true);
    expect(first.editor.getDocument()).toBe("first opened file");
    expect(first.editor.undo()).toBe(false);

    first.destroy();
    second.destroy();
    firstContainer.remove();
    secondContainer.remove();
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
    expect(document.body.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='nexus-wordcount-bar']")).toHaveLength(0);

    shell.destroy();
    container.remove();
  });
});
