import { describe, expect, it, vi } from "vitest";
import { loadDocumentIntoEditor } from "../src/renderer/app-document-loader";
import { createState } from "../src/renderer/state";

describe("loadDocumentIntoEditor", () => {
  it("does not update file state when the editor shell is not ready", () => {
    const state = createState();
    state.filePath = "/previous.md";
    state.activeFile = "/previous.md";
    state.content = "previous";

    expect(() =>
      loadDocumentIntoEditor({
        state,
        shell: null,
        file: { path: "/next.md", content: "next" },
      })
    ).toThrow("Editor is still starting");

    expect(state.filePath).toBe("/previous.md");
    expect(state.activeFile).toBe("/previous.md");
    expect(state.content).toBe("previous");
  });

  it("loads content before switching the active file path", () => {
    const state = createState();
    const shell = {
      loadDocument: vi.fn(() => {
        expect(state.activeFile).toBeNull();
        state.content = "next";
      }),
    };

    loadDocumentIntoEditor({
      state,
      shell,
      file: { path: "/next.md", content: "next" },
    });

    expect(shell.loadDocument).toHaveBeenCalledWith("next");
    expect(state.filePath).toBe("/next.md");
    expect(state.activeFile).toBe("/next.md");
  });
});
