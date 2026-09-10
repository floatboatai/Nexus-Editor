import { afterEach, describe, expect, it } from "vitest";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createEditor, type EditorAPI } from "../src/index";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function setup(initialValue = "current", history = true, readOnly = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container, initialValue, readOnly, livePreview: true,
    plugins: [createGfmPreset(), ...(history ? [createHistoryPlugin()] : [])],
  });
  editors.push(editor);
  return { editor, container };
}

async function restore(editor: EditorAPI, markdown: string, expectedRevision?: string) {
  if (!editor.restoreDocumentBuffer || !editor.getDocumentRevision) throw new Error("Missing restore API");
  return editor.restoreDocumentBuffer(markdown, { expectedRevision: expectedRevision ?? editor.getDocumentRevision() });
}

function pendingCell(container: HTMLElement) {
  const cell = Array.from(container.querySelectorAll<HTMLElement>(".nexus-cell")).at(-1);
  if (!cell) throw new Error("Missing table");
  cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  cell.tabIndex = -1;
  cell.focus();
  cell.textContent = "pending";
  cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  return cell;
}

describe("versioned buffer restoration", () => {
  it("isolates restoration from preceding edits and checks revisions", async () => {
    const { editor } = setup();
    const initial = await editor.captureDocumentSnapshot();
    editor.replaceRange(0, 7, "new input");
    expect((await restore(editor, "old", initial.revision)).status).toBe("conflict");
    expect(editor.getDocument()).toBe("new input");
    expect((await restore(editor, "archived")).status).toBe("applied");
    expect(editor.getDocument()).toBe("archived");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("new input");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("current");
  });

  it("keeps pending table text as the state restored by one undo", async () => {
    const { editor, container } = setup("| A | B |\n| --- | --- |\n| 1 | old |");
    const before = editor.getDocumentRevision?.();
    pendingCell(container);
    expect(editor.getDocumentRevision?.()).not.toBe(before);
    const captured = await editor.captureDocumentSnapshot();
    expect(captured.markdown).toContain("pending");
    expect((await restore(editor, "historical", captured.revision)).status).toBe("applied");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(captured.markdown);
  });

  it("preserves pending data when a filter rejects its commit", async () => {
    const { editor, container } = setup("| A | B |\n| --- | --- |\n| 1 | old |");
    const cell = pendingCell(container);
    const registration = editor.getContributionSink().registerTransactionFilter("deny", () => ({ action: "reject" }));
    expect((await restore(editor, "historical")).status).toBe("transaction-rejected");
    expect(cell.textContent).toBe("pending");
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("pending");
    await registration.dispose();
  });

  it("does not restore read-only editors or claim undo without history", async () => {
    expect((await restore(setup("current", true, true).editor, "old")).status).toBe("read-only");
    expect((await restore(setup("current", false).editor, "old")).status).toBe("history-unavailable");
  });

  it("keeps the table session editable when only restoration is rejected", async () => {
    const { editor, container } = setup("| A | B |\n| --- | --- |\n| 1 | old |");
    const cell = pendingCell(container);
    editor.getContributionSink().registerTransactionFilter("deny-restore", (context) =>
      context.userEvent === "input.restore" ? { action: "reject" } : { action: "accept" },
    );
    expect((await restore(editor, "historical")).status).toBe("transaction-rejected");
    expect(editor.getDocument()).toContain("pending");
    expect(cell.isConnected).toBe(true);
    cell.textContent = "continued after rejection";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("continued after rejection");
    cell.blur();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.getDocument()).toContain("continued after rejection");
  });

  it("rejects a current restore when its transaction is filtered", async () => {
    const { editor } = setup();
    editor.getContributionSink().registerTransactionFilter("deny", () => ({ action: "reject" }));
    expect((await restore(editor, "old")).status).toBe("transaction-rejected");
    expect(editor.getDocument()).toBe("current");
  });

  it("cancels while composition is pending", async () => {
    const { editor, container } = setup();
    if (!editor.restoreDocumentBuffer || !editor.getDocumentRevision) throw new Error("Missing restore API");
    container.querySelector(".cm-content")?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const abort = new AbortController();
    const pending = editor.restoreDocumentBuffer("old", { expectedRevision: editor.getDocumentRevision(), signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(editor.getDocument()).toBe("current");
  });
});
