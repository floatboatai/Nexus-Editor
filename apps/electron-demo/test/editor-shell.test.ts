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

  it("inserts a Markdown image when a clipboard image is persisted by the host", async () => {
    const container = document.createElement("div");
    const onAssetUpload = vi.fn().mockResolvedValue("../assets/screenshot.png");
    const shell = createEditorShell({
      container,
      state: createState(),
      settings: defaultSettings(),
      onStateChange: vi.fn(),
      onAssetUpload,
    });
    const file = new File(["image"], "screenshot.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        items: [{ kind: "file", getAsFile: () => file }],
        getData: () => "",
      },
    });

    container.querySelector(".cm-content")?.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(event.defaultPrevented).toBe(true);
    expect(onAssetUpload).toHaveBeenCalledWith(file);
    expect(shell.editor.getDocument()).toBe("![screenshot.png](../assets/screenshot.png)");
    shell.destroy();
  });

  it("previews a pasted image whose relative path contains encoded spaces", () => {
    const container = document.createElement("div");
    const state = createState();
    state.content = "![screen shot](../assets/screen%20shot.png)";
    state.activeFile = "C:\\vault\\notes\\note.md";
    state.vaultPath = "C:\\vault";

    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
    });

    expect(container.querySelector("img")?.src).toBe(
      "nexus-vault://vault/assets/screen%20shot.png"
    );
    shell.destroy();
  });
});
