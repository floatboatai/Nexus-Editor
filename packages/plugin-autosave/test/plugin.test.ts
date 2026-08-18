import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";

import {
  attachAutoSavePlugin,
  createAutoSavePlugin
} from "../src/plugin";

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("createAutoSavePlugin", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  it("saves the latest markdown after the debounce delay", async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const autosave = createAutoSavePlugin({ onSave, delay: 100 });
      editor = createEditor({ container, initialValue: "a", plugins: [autosave] });
      attachAutoSavePlugin(autosave, editor);
      await vi.runAllTimersAsync();

      onSave.mockClear();
      editor.setDocument("a b c");
      expect(onSave).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(120);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("a b c");
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses bursts of edits into a single save", async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const autosave = createAutoSavePlugin({ onSave, delay: 200 });
      editor = createEditor({ container, initialValue: "a", plugins: [autosave] });
      attachAutoSavePlugin(autosave, editor);
      await vi.runAllTimersAsync();

      onSave.mockClear();
      editor.setDocument("a b");
      editor.setDocument("a b c");
      editor.setDocument("a b c d");
      expect(onSave).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("a b c d");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not save before the delay elapses", async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const autosave = createAutoSavePlugin({ onSave, delay: 500 });
      editor = createEditor({ container, initialValue: "x", plugins: [autosave] });
      attachAutoSavePlugin(autosave, editor);
      await vi.runAllTimersAsync();

      onSave.mockClear();
      editor.setDocument("x y");
      await vi.advanceTimersByTimeAsync(200);
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not save on attach without an edit", async () => {
    const onSave = vi.fn();
    const autosave = createAutoSavePlugin({ onSave });
    editor = createEditor({ container, initialValue: "hello", plugins: [autosave] });
    attachAutoSavePlugin(autosave, editor);
    await flushMicrotasks();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flush() forces an immediate save and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const autosave = createAutoSavePlugin({ onSave, delay: 1000 });
      editor = createEditor({ container, initialValue: "a", plugins: [autosave] });
      attachAutoSavePlugin(autosave, editor);
      await vi.runAllTimersAsync();

      onSave.mockClear();
      editor.setDocument("a b");
      expect(onSave).not.toHaveBeenCalled();
      await autosave.flush();
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("a b");
      // pending timer must be cleared so no second save fires later
      await vi.advanceTimersByTimeAsync(2000);
      expect(onSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy() silences further saves", async () => {
    const onSave = vi.fn();
    const autosave = createAutoSavePlugin({ onSave, delay: 0 });
    editor = createEditor({ container, initialValue: "hello", plugins: [autosave] });
    attachAutoSavePlugin(autosave, editor);
    await flushMicrotasks();

    onSave.mockClear();
    autosave.destroy();
    editor.setDocument("hello world");
    await flushMicrotasks();
    expect(onSave).not.toHaveBeenCalled();
  });
});
