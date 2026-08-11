import { describe, expect, it, vi } from "vitest";
import { createEditorShell } from "../src/renderer/editor-shell";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";
import type { FoundationModelsBridge, NativeAvailability } from "../src/renderer/foundation-models";

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

  it("exposes the Foundation Models controller and clears suggestions before loading a document", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const state = createState();
    state.content = "A paragraph";
    const availability: NativeAvailability = {
      available: true,
      platform: "macos",
      minimumOS: "26.0",
    };
    const bridge: FoundationModelsBridge = {
      getAvailability: vi.fn(async () => availability),
      suggest: vi.fn(async () => "next."),
      cancelSuggestion: vi.fn(async () => undefined),
    };
    const shell = createEditorShell({
      container,
      state,
      settings: defaultSettings(),
      onStateChange: vi.fn(),
      foundationModels: {
        bridge,
        availability,
        enabled: true,
      },
    });

    shell.editor.setSelection(state.content.length);
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    expect(container.querySelector(".nexus-foundation-suggestion")?.textContent).toBe("next.");

    shell.loadDocument("loaded");

    expect(shell.foundationModels).toBeDefined();
    expect(container.querySelector(".nexus-foundation-suggestion")).toBeNull();
    shell.destroy();
    vi.useRealTimers();
  });
});
