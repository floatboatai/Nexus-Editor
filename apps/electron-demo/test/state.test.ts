import { describe, expect, it } from "vitest";
import {
  createState,
  hasUnsavedChanges,
  markContentLoaded,
  markContentSaved,
  syncEditorContent,
} from "../src/renderer/state";

describe("createState", () => {
  it("initializes with no file path and not dirty", () => {
    const state = createState();
    expect(state.filePath).toBeNull();
    expect(state.content).toBe("");
    expect(state.savedContent).toBe("");
    expect(state.dirty).toBe(false);
    expect(state.error).toBeNull();
  });

  it("detects unsaved text before a debounced onChange reaches state", () => {
    const state = createState();
    markContentLoaded(state, "saved");

    expect(state.dirty).toBe(false);
    expect(hasUnsavedChanges(state, "saved plus a fast edit")).toBe(true);
  });

  it("derives dirty state from the last persisted snapshot", () => {
    const state = createState();
    markContentLoaded(state, "saved");

    syncEditorContent(state, "edited");
    expect(state.dirty).toBe(true);

    syncEditorContent(state, "saved");
    expect(state.dirty).toBe(false);
  });

  it("keeps edits made while a save is in flight dirty", () => {
    const state = createState();
    markContentLoaded(state, "before");

    markContentSaved(state, "saved snapshot", "newer editor buffer");

    expect(state.savedContent).toBe("saved snapshot");
    expect(state.content).toBe("newer editor buffer");
    expect(state.dirty).toBe(true);
  });
});
