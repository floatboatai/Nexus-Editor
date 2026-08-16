import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorAPI } from "@floatboat/nexus-core";

import { attachAutosavePlugin, createAutosavePlugin } from "../src/index";

interface MockEditor {
  doc: string;
  changeListeners: Array<() => void>;
  getDocument: () => string;
  on: (event: "change", cb: () => void) => void;
  off: (event: "change", cb: () => void) => void;
  triggerChange: () => void;
}

function createMockEditor(initial: string): MockEditor {
  const editor: MockEditor = {
    doc: initial,
    changeListeners: [],
    getDocument: () => editor.doc,
    on: (_event, cb) => {
      editor.changeListeners.push(cb);
    },
    off: (_event, cb) => {
      const idx = editor.changeListeners.indexOf(cb);
      if (idx >= 0) editor.changeListeners.splice(idx, 1);
    },
    triggerChange: () => {
      for (const cb of [...editor.changeListeners]) cb();
    }
  };
  return editor;
}

const asEditor = (editor: MockEditor): EditorAPI => editor as unknown as EditorAPI;

describe("createAutosavePlugin", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requires an onSave function", () => {
    expect(() => createAutosavePlugin({ onSave: undefined as never })).toThrow(TypeError);
  });

  it("does not save the initially loaded document", () => {
    const onSave = vi.fn();
    const editor = createMockEditor("# Hello");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    expect(autosave.getState().dirty).toBe(false);
    vi.advanceTimersByTime(200);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the latest document after the debounce window", async () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "ab";
    editor.triggerChange();
    expect(autosave.getState().dirty).toBe(true);
    expect(autosave.getState().pending).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("ab");
    expect(autosave.getState().dirty).toBe(false);
    expect(autosave.getState().pending).toBe(false);
  });

  it("collapses rapid edits into a single save of the final text", () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "ab";
    editor.triggerChange();
    vi.advanceTimersByTime(50);
    editor.doc = "abc";
    editor.triggerChange();
    vi.advanceTimersByTime(50);
    editor.doc = "abcd";
    editor.triggerChange();

    vi.advanceTimersByTime(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("abcd");
  });

  it("flush() persists immediately and reports true", async () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 1000, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "changed";
    editor.triggerChange();
    const flushed = await autosave.flush();
    expect(flushed).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("changed");
    expect(autosave.getState().dirty).toBe(false);
  });

  it("flush() returns false when the document is clean", async () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ onSave });
    attachAutosavePlugin(autosave, asEditor(editor));
    expect(await autosave.flush()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cancel() drops a pending save but keeps dirty state", () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "changed";
    editor.triggerChange();
    autosave.cancel();
    vi.advanceTimersByTime(200);
    expect(onSave).not.toHaveBeenCalled();
    expect(autosave.getState().dirty).toBe(true);
  });

  it("awaits an async onSave before clearing dirty", async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "changed";
    editor.triggerChange();
    vi.advanceTimersByTime(100);
    expect(autosave.getState().saving).toBe(true);
    resolveSave();
    await vi.waitFor(() => expect(autosave.getState().saving).toBe(false));
    expect(autosave.getState().dirty).toBe(false);
  });

  it("keeps the document dirty when onSave rejects, then retries on the next edit", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "b";
    editor.triggerChange();
    vi.advanceTimersByTime(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(autosave.getState().dirty).toBe(true);

    editor.doc = "bc";
    editor.triggerChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("bc");
    expect(autosave.getState().dirty).toBe(false);
  });

  it("detaches on destroy and stops scheduling saves", () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ delay: 100, onSave });
    attachAutosavePlugin(autosave, asEditor(editor));

    editor.doc = "changed";
    editor.triggerChange();
    autosave.destroy();
    vi.advanceTimersByTime(200);
    expect(onSave).not.toHaveBeenCalled();

    editor.doc = "more";
    editor.triggerChange();
    vi.advanceTimersByTime(200);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("is idempotent across repeated attach calls", () => {
    const onSave = vi.fn();
    const editor = createMockEditor("a");
    const autosave = createAutosavePlugin({ onSave });
    attachAutosavePlugin(autosave, asEditor(editor));
    attachAutosavePlugin(autosave, asEditor(editor));
    expect(editor.changeListeners.length).toBe(1);
  });
});
