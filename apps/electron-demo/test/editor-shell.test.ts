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

  it("opts into headless search and delegates image loading to the asset provider", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const state = createState(); state.content = "![image](nexus-asset:local/one)";
    const read = vi.fn(async () => null);
    const shell = createEditorShell({
      container, state, settings: defaultSettings(), onStateChange: vi.fn(), searchUI: "headless",
      assetProvider: { read }, assetInput: { managed: true },
      contributionFeatures: { toolbar: false, slashMenu: false, wordCount: false },
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(container.querySelector("img[src^='nexus-asset:']")).toBeNull();
    shell.editor.runShortcut("Mod-f");
    expect(container.querySelector(".cm-search")).toBeNull();
    shell.destroy(); container.remove();
  });
});
