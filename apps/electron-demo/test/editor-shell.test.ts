import { describe, expect, it, vi } from "vitest";
import { createReferencePluginBootPlan } from "@floatboat/nexus-reference-plugins";
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
      pluginPlan: createReferencePluginBootPlan({
        pluginPlatform: true, toolbar: true, slashMenu: true, wordCount: true, blockDrag: true,
      }),
      onStateChange: vi.fn(),
    });

    expect(shell.toolbar).toBeNull();
    expect(shell.slashMenu).toBeNull();
    expect(shell.wordcount).toBeNull();
    expect(container.querySelectorAll(".nexus-toolbar")).toHaveLength(0);
    expect(document.body.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);
    expect(container.querySelectorAll(".nexus-wordcount__bar")).toHaveLength(0);
    expect(container.querySelectorAll(".nexus-block-drag-layer")).toHaveLength(0);

    shell.destroy();
    container.remove();
  });

  it.each([false, true])("uses the supplied legacy plugin instances (blockDrag=%s)", async (blockDrag) => {
    const container = document.createElement("div");
    document.body.append(container);
    const pluginPlan = createReferencePluginBootPlan({
      pluginPlatform: false, toolbar: true, slashMenu: false, wordCount: true, blockDrag,
    });
    const state = createState();
    state.content = "Alpha beta";
    const shell = createEditorShell({
      container, state, settings: defaultSettings(), pluginPlan, onStateChange: vi.fn(),
    });
    await Promise.resolve();

    expect(shell.wordcount).toBe(pluginPlan.legacyWordCount);
    expect(shell.wordcount?.getStats().words).toBe(2);
    expect(container.querySelectorAll(".nexus-toolbar")).toHaveLength(1);
    expect(container.querySelectorAll(".nexus-wordcount__bar")).toHaveLength(1);
    expect(container.querySelectorAll(".nexus-block-drag-layer")).toHaveLength(Number(blockDrag));
    expect(shell.slashMenu).toBeNull();
    const commandIds = shell.editor.getSlashCommands().map((command) => command.id);
    expect(commandIds.length).toBeGreaterThan(0);
    expect(commandIds).toHaveLength(new Set(commandIds).size);

    shell.destroy();
    expect(container.querySelectorAll(".nexus-wordcount__bar, .nexus-toolbar, .nexus-block-drag-layer")).toHaveLength(0);
    container.remove();
  });
});
