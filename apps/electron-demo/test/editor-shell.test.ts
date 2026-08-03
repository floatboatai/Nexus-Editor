import { describe, expect, it, vi } from "vitest";
import { createEditorShell } from "../src/renderer/editor-shell";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";

describe("createEditorShell", () => {
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

  it("ignores a debounced change superseded by a silent file load", async () => {
    const container = document.createElement("div");
    const state = createState();
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    shell.editor.setDocument("pending edit from the previous file");
    shell.loadDocument("newly loaded file");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(state.content).toBe("newly loaded file");
    expect(state.savedContent).toBe("newly loaded file");
    expect(state.dirty).toBe(false);
    shell.destroy();
  });
});
