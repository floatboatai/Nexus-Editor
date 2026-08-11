import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createFoundationModelsPlugin } from "../src/renderer/foundation-models-plugin";
import type { FoundationModelsBridge, NativeAvailability } from "../src/renderer/foundation-models";
import type { NexusPlugin } from "@floatboat/nexus-core";

const AVAILABLE: NativeAvailability = {
  available: true,
  platform: "macos",
  minimumOS: "26.0",
};

const UNAVAILABLE: NativeAvailability = {
  available: false,
  platform: "macos",
  minimumOS: "26.0",
  reason: "model-unavailable",
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeBridge(result: string | null | Promise<string | null>): FoundationModelsBridge {
  return {
    getAvailability: vi.fn(async () => AVAILABLE),
    suggest: vi.fn(() => Promise.resolve(result)),
    cancelSuggestion: vi.fn(async () => undefined),
  };
}

function createCancellableBridge(result: string | null | Promise<string | null>): FoundationModelsBridge & {
  cancelSuggestion: ReturnType<typeof vi.fn>;
} {
  return {
    getAvailability: vi.fn(async () => AVAILABLE),
    suggest: vi.fn(() => Promise.resolve(result)),
    cancelSuggestion: vi.fn(async () => undefined),
  };
}

async function flushDebounce(): Promise<void> {
  vi.advanceTimersByTime(500);
  await vi.runAllTimersAsync();
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createTestFeature(
  bridge: FoundationModelsBridge,
  initialValue = "A paragraph",
  options: { enabled?: boolean; availability?: NativeAvailability } = {}
): {
  container: HTMLElement;
  editor: EditorAPI;
  controller: ReturnType<typeof createFoundationModelsPlugin>["controller"];
  plugin: NexusPlugin;
  dispatchKeydown: (event: KeyboardEvent) => boolean;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const feature = createFoundationModelsPlugin({
    bridge,
    enabled: options.enabled ?? true,
    availability: options.availability ?? AVAILABLE,
  });
  const editor = createEditor({
    container,
    initialValue,
    multiCursor: true,
    plugins: [feature],
  });

  return {
    container,
    editor,
    controller: feature.controller,
    plugin: feature,
    dispatchKeydown(event: KeyboardEvent): boolean {
      const content = container.querySelector<HTMLElement>(".cm-content");
      if (!content) throw new Error("Expected CodeMirror content DOM");
      content.dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
}

function runPluginKeydown(plugin: NexusPlugin, editor: EditorAPI, key: string): boolean {
  return plugin.handlers?.keydown?.(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    {
      editor,
      insertMarkdown: (markdown: string) => editor.replaceSelection(markdown),
      uploadAsset: async () => null,
    }
  ) === true;
}

async function createTestFeatureWithSuggestion(result = "next."): Promise<ReturnType<typeof createTestFeature>> {
  const feature = createTestFeature(createFakeBridge(result));
  feature.editor.setSelection(feature.editor.getDocument().length);
  await flushDebounce();
  expect(document.querySelector(".nexus-foundation-suggestion")?.textContent).toBe(result);
  return feature;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("createFoundationModelsPlugin", () => {
  it("requests after 500ms only for an eligible paragraph", async () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge("next sentence.");
    const { editor, controller } = createTestFeature(bridge, "A paragraph");

    editor.setSelection(11);
    vi.advanceTimersByTime(499);
    expect(bridge.suggest).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(bridge.suggest).toHaveBeenCalledWith("A paragraph");
    expect(document.querySelector(".nexus-foundation-suggestion")?.textContent).toBe("next sentence.");

    editor.setDocument("# Heading");
    editor.setSelection(9);
    await flushDebounce();
    expect(bridge.suggest).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("does not show a late result after the user edits", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const bridge = createFakeBridge(pending.promise);
    const { editor, controller } = createTestFeature(bridge, "A paragraph");

    editor.setSelection(11);
    await flushDebounce();
    editor.replaceRange(11, 11, "!");
    pending.resolve("stale");
    await flushPromises();

    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    controller.dispose();
  });

  it("cancels an in-flight native request when the document changes", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const bridge = createCancellableBridge(pending.promise);
    const { editor, controller } = createTestFeature(bridge, "A paragraph");

    editor.setSelection(11);
    await flushDebounce();
    expect(bridge.suggest).toHaveBeenCalledTimes(1);

    editor.replaceRange(11, 11, "!");

    expect(bridge.cancelSuggestion).toHaveBeenCalledTimes(1);
    pending.resolve("stale");
    await flushPromises();
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    controller.dispose();
  });

  it("cancels active native requests on Escape, blur, disable, and dispose", async () => {
    vi.useFakeTimers();

    const escapePending = deferred<string | null>();
    const escapeBridge = createCancellableBridge(escapePending.promise);
    const escapeFeature = createTestFeature(escapeBridge, "A paragraph");
    escapeFeature.editor.setSelection(11);
    await flushDebounce();
    escapeFeature.dispatchKeydown(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(escapeBridge.cancelSuggestion).toHaveBeenCalledTimes(1);
    escapeFeature.controller.dispose();

    const blurPending = deferred<string | null>();
    const blurBridge = createCancellableBridge(blurPending.promise);
    const blurFeature = createTestFeature(blurBridge, "A paragraph");
    blurFeature.editor.setSelection(11);
    await flushDebounce();
    blurFeature.container.querySelector<HTMLElement>(".cm-content")?.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    expect(blurBridge.cancelSuggestion).toHaveBeenCalledTimes(1);
    blurFeature.controller.dispose();

    const disabledPending = deferred<string | null>();
    const disabledBridge = createCancellableBridge(disabledPending.promise);
    const disabledFeature = createTestFeature(disabledBridge, "A paragraph");
    disabledFeature.editor.setSelection(11);
    await flushDebounce();
    disabledFeature.controller.setEnabled(false);
    expect(disabledBridge.cancelSuggestion).toHaveBeenCalledTimes(1);
    disabledFeature.controller.dispose();

    const disposePending = deferred<string | null>();
    const disposeBridge = createCancellableBridge(disposePending.promise);
    const disposeFeature = createTestFeature(disposeBridge, "A paragraph");
    disposeFeature.editor.setSelection(11);
    await flushDebounce();
    disposeFeature.controller.dispose();
    expect(disposeBridge.cancelSuggestion).toHaveBeenCalledTimes(1);
  });

  it("accepts only a collapsed single selection with Tab", async () => {
    vi.useFakeTimers();
    const { editor, dispatchKeydown, controller, plugin } = await createTestFeatureWithSuggestion("next.");

    expect(dispatchKeydown(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))).toBe(true);
    expect(editor.getDocument()).toBe("A paragraphnext.");
    expect(editor.getSelection()).toEqual({ anchor: 16, head: 16 });
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();

    editor.setSelection(0, 1);
    expect(runPluginKeydown(plugin, editor, "Tab")).toBe(false);
    expect(editor.getDocument()).toBe("A paragraphnext.");

    controller.dispose();
  });

  it("keeps Tab available for multiple cursors", async () => {
    vi.useFakeTimers();
    const { editor, plugin, controller } = await createTestFeatureWithSuggestion("next.");

    editor.setSelections([{ anchor: 1 }, { anchor: 3 }], 1);

    expect(runPluginKeydown(plugin, editor, "Tab")).toBe(false);
    controller.dispose();
  });

  it("clears a visible suggestion on Escape and blur", async () => {
    vi.useFakeTimers();
    const first = await createTestFeatureWithSuggestion("next.");
    expect(first.dispatchKeydown(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))).toBe(true);
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    first.controller.dispose();

    const second = await createTestFeatureWithSuggestion("after blur.");
    second.container.querySelector<HTMLElement>(".cm-content")?.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    second.controller.dispose();
  });

  it("does not render null results or rejected results", async () => {
    vi.useFakeTimers();
    const nullFeature = createTestFeature(createFakeBridge(null));
    nullFeature.editor.setSelection(11);
    await flushDebounce();
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    nullFeature.controller.dispose();

    const rejectingBridge: FoundationModelsBridge = {
      getAvailability: vi.fn(async () => AVAILABLE),
      suggest: vi.fn(async () => {
        throw new Error("native failed");
      }),
      cancelSuggestion: vi.fn(async () => undefined),
    };
    const rejectedFeature = createTestFeature(rejectingBridge);
    rejectedFeature.editor.setSelection(11);
    await flushDebounce();
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
    rejectedFeature.controller.dispose();
  });

  it("uses cached repeated paragraph results without starting a second native request", async () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge("cached next.");
    const { editor, controller } = createTestFeature(bridge, "A paragraph");

    editor.setSelection(11);
    await flushDebounce();
    expect(bridge.suggest).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".nexus-foundation-suggestion")?.textContent).toBe("cached next.");

    controller.clear();
    editor.setSelection(10);
    editor.setSelection(11);
    await flushDebounce();

    expect(bridge.suggest).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".nexus-foundation-suggestion")?.textContent).toBe("cached next.");
    expect(controller.getDiagnostics()).toMatchObject({
      cacheHits: 1,
      nativeStarts: 1,
      renderedSuggestions: 2,
    });
    expect(JSON.stringify(controller.getDiagnostics())).not.toContain("A paragraph");
    expect(JSON.stringify(controller.getDiagnostics())).not.toContain("cached next.");
    controller.dispose();
  });

  it("does not request while disabled or unavailable", async () => {
    vi.useFakeTimers();
    const disabledBridge = createFakeBridge("nope");
    const disabled = createTestFeature(disabledBridge, "A paragraph", { enabled: false });
    disabled.editor.setSelection(11);
    await flushDebounce();
    expect(disabledBridge.suggest).not.toHaveBeenCalled();

    disabled.controller.setEnabled(true);
    await flushDebounce();
    expect(disabledBridge.suggest).toHaveBeenCalledWith("A paragraph");
    disabled.controller.dispose();

    const unavailableBridge = createFakeBridge("nope");
    const unavailable = createTestFeature(unavailableBridge, "A paragraph", { availability: UNAVAILABLE });
    unavailable.editor.setSelection(11);
    await flushDebounce();
    expect(unavailableBridge.suggest).not.toHaveBeenCalled();
    unavailable.controller.setAvailability(AVAILABLE);
    await flushDebounce();
    expect(unavailableBridge.suggest).toHaveBeenCalledWith("A paragraph");
    unavailable.controller.dispose();
  });

  it("cancels timers and pending results on disposal", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const bridge = createFakeBridge(pending.promise);
    const { editor, controller } = createTestFeature(bridge, "A paragraph");

    editor.setSelection(11);
    controller.dispose();
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    expect(bridge.suggest).not.toHaveBeenCalled();

    controller.setEnabled(true);
    pending.resolve("ignored");
    await flushPromises();
    expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
  });
});
