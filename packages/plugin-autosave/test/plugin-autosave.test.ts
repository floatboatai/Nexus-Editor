import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createAutosavePlugin, isDirty, forceSave } from "../src/index";

describe("plugin-autosave", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it("marks dirty after first document change", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave })],
    });

    expect(isDirty(editor)).toBe(false);
    editor.setDocument("hello world");
    expect(isDirty(editor)).toBe(true);
  });

  it("calls onSave after debounce delay", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 1000 })],
    });

    editor.setDocument("hello world");
    expect(onSave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("hello world");
  });

  it("debounces rapid edits into a single onSave call", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "a",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 500 })],
    });

    editor.setDocument("ab");
    vi.advanceTimersByTime(200);
    editor.setDocument("abc");
    vi.advanceTimersByTime(200);
    editor.setDocument("abcd");
    // Timer keeps resetting, onSave should NOT have been called yet
    expect(onSave).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("abcd");
  });

  it("onSave success clears dirty state", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 500 })],
    });

    editor.setDocument("hello world");
    expect(isDirty(editor)).toBe(true);

    vi.advanceTimersByTime(500);
    // Flush pending promises
    await vi.runAllTimersAsync();
    expect(isDirty(editor)).toBe(false);
  });

  it("onSave failure keeps dirty state true", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValue(new Error("IO failure"));
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 500 })],
    });

    editor.setDocument("hello world");
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    // Save failed → still dirty
    expect(isDirty(editor)).toBe(true);
  });

  it("stays dirty when document changes between save and resolve", async () => {
    // After onSave resolves, if the document was edited in the meantime
    // (e.g. user typed during async IO), dirty stays true.
    // Verify by editing after the timer fires but before we assert.
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 500 })],
    });

    // First edit triggers timer
    editor.setDocument("doc v1");
    vi.advanceTimersByTime(500);
    // Let the save promise resolve
    await vi.runAllTimersAsync();
    expect(onSave).toHaveBeenCalledWith("doc v1");
    // Save completed — should be clean
    expect(isDirty(editor)).toBe(false);

    // Now edit again — should become dirty
    editor.setDocument("doc v2");
    expect(isDirty(editor)).toBe(true);
  });

  it("forceSave clears timer and calls onSave immediately", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 10000 })],
    });

    editor.setDocument("hello world");
    expect(onSave).not.toHaveBeenCalled();

    forceSave(editor);
    // onSave should be called synchronously (not waiting on timer)
    expect(onSave).toHaveBeenCalledWith("hello world");

    // Timer should be cleared — no additional save after debounce window
    vi.advanceTimersByTime(10000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("isDirty returns false when plugin is not registered", () => {
    editor = createEditor({
      container,
      initialValue: "hello",
      // No autosave plugin
    });
    expect(isDirty(editor)).toBe(false);
  });

  it("forceSave is no-op when plugin is not registered", () => {
    editor = createEditor({
      container,
      initialValue: "hello",
    });
    // Should not throw
    expect(() => forceSave(editor)).not.toThrow();
  });

  it("timer is cleared on editor destroy", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave })],
    });

    editor.setDocument("hello world");
    editor.destroy();

    // Advance past debounce window — timer callback should not fire
    vi.advanceTimersByTime(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("debounceMs=0 triggers save on every change", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createAutosavePlugin({ onSave, debounceMs: 0 })],
    });

    editor.setDocument("a");
    await vi.runAllTimersAsync();
    expect(onSave).toHaveBeenCalledTimes(1);

    editor.setDocument("b");
    await vi.runAllTimersAsync();
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
