import { afterEach, describe, expect, it, vi } from "vitest";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createEditor, type AssetInputEvent, type EditorAPI } from "../src/index";

const original = "| A | B |\n| --- | --- |\n| 1 | old |";
const editors: EditorAPI[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function setup() {
  const container = document.createElement("div");
  document.body.append(container);
  const events: AssetInputEvent[] = [];
  const editor = createEditor({
    container,
    initialValue: original,
    livePreview: true,
    plugins: [createGfmPreset(), createHistoryPlugin()],
    assetInput: { managed: true, onEvent: (event) => events.push(event) },
    onAssetUpload: async () => "http://example.invalid/image.png",
  });
  editors.push(editor);
  return { editor, container, events };
}

function lastCell(container: HTMLElement): HTMLElement {
  const cell = Array.from(container.querySelectorAll<HTMLElement>(".nexus-cell")).at(-1);
  if (!cell) throw new Error("Missing table cell");
  return cell;
}

function activate(cell: HTMLElement): void {
  cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  cell.tabIndex = -1;
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function input(cell: HTMLElement, text: string): void {
  cell.textContent = text;
  cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

function paste(cell: HTMLElement): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [new File(["image"], "a.png", { type: "image/png" })] },
  });
  cell.dispatchEvent(event);
}

async function blur(cell: HTMLElement): Promise<void> {
  cell.blur();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("table commits rewritten by transaction filters", () => {
  it.each([false, true])("preserves a normalized upload and subsequent edits when prefix insertion is %s", async (prefix) => {
    const { editor, container, events } = setup();
    const cell = lastCell(container);
    activate(cell);
    editor.getContributionSink().registerTransactionFilter("normalize-url", (context) => {
      if (context.userEvent !== "input.paste") return { action: "accept" };
      return {
        action: "replace",
        transaction: {
          origin: [],
          changes: context.changes.map((change) => ({
            ...change,
            insert: (prefix ? "# Inserted before table\n\n" : "") + change.insert.replace("http://", "https://"),
          })),
        },
      };
    });
    paste(cell);
    await vi.waitFor(() => expect(events.at(-1)?.status).not.toBe("uploading"));
    expect(events.at(-1)?.status).toBe("inserted");
    const committed = editor.getDocument();
    expect(committed).toContain("https://example.invalid/image.png");
    const current = lastCell(container);
    expect(current).not.toBe(cell);
    expect(cell.isConnected).toBe(false);
    expect(cell.contentEditable).toBe("false");
    expect(document.activeElement).toBe(current);
    expect(current.textContent).toContain("https://example.invalid/image.png");
    input(current, `${current.textContent} continued`);
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("continued");
    await blur(current);
    expect(editor.getDocument()).toContain("continued");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(committed);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
  });

  it("keeps a normalized strict flush usable after restoration reports a conflict", async () => {
    const { editor, container } = setup();
    const cell = lastCell(container);
    activate(cell);
    input(cell, "pending");
    editor.getContributionSink().registerTransactionFilter("normalize-pending", (context) => {
      if (!context.changes.some((change) => change.insert.includes("pending"))) return { action: "accept" };
      return {
        action: "replace",
        transaction: {
          origin: [],
          changes: context.changes.map((change) => ({ ...change, insert: change.insert.replace("pending", "normalized") })),
        },
      };
    });
    if (!editor.restoreDocumentBuffer || !editor.getDocumentRevision) throw new Error("Missing restore API");
    const revision = editor.getDocumentRevision();
    const result = await editor.restoreDocumentBuffer("historical", { expectedRevision: revision });
    expect(result.status).toBe("conflict");
    expect(result.revision).not.toBe(revision);
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("normalized");
    const current = lastCell(container);
    expect(document.activeElement).toBe(current);
    input(current, "normalized continued");
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("normalized continued");
    await blur(current);
    expect(editor.getDocument()).toContain("normalized continued");
    const afterEditing = editor.getDocument();
    expect((await editor.restoreDocumentBuffer("historical", { expectedRevision: editor.getDocumentRevision() })).status).toBe("applied");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(afterEditing);
    expect((await editor.captureDocumentSnapshot()).markdown).toBe(afterEditing);
  });

  it.each(["paragraph", "different-table"])("rebuilds %s replacements without keeping an editable zombie cell", async (shape) => {
    const { editor, container, events } = setup();
    const cell = lastCell(container);
    activate(cell);
    const replacement = shape === "paragraph" ? "Filtered into plain text" : "| One column |\n| --- |\n| changed |";
    editor.getContributionSink().registerTransactionFilter("change-structure", (context) =>
      context.userEvent === "input.paste"
        ? { action: "replace", transaction: { origin: [], changes: context.changes.map((change) => ({ ...change, insert: replacement })) } }
        : { action: "accept" },
    );
    paste(cell);
    await vi.waitFor(() => expect(events.at(-1)?.status).not.toBe("uploading"));
    expect(events.at(-1)?.status).toBe("inserted");
    expect(editor.getDocument()).toBe(replacement);
    expect(cell.isConnected).toBe(false);
    expect(cell.contentEditable).toBe("false");
    expect(editor.getContributionSink().isInteractionActive()).toBe(false);
    input(cell, "detached input must not be committed");
    cell.dispatchEvent(new FocusEvent("blur"));
    await Promise.resolve();
    expect((await editor.captureDocumentSnapshot()).markdown).toBe(replacement);
    if (shape === "different-table") {
      const current = lastCell(container);
      activate(current);
      input(current, "continued on the new table");
      expect((await editor.captureDocumentSnapshot()).markdown).toContain("continued on the new table");
      await blur(current);
      expect(editor.getDocument()).toContain("continued on the new table");
    }
  });

  it.each(["empty", "original"])("preserves pending input when a strict commit is replaced with %s content", async (replacement) => {
    const { editor, container } = setup();
    const cell = lastCell(container);
    activate(cell);
    input(cell, "pending");
    const registration = editor.getContributionSink().registerTransactionFilter("no-op", (context) => ({
      action: "replace",
      transaction: {
        origin: [],
        changes: replacement === "empty" ? [] : context.changes.map((change) => ({ ...change, insert: original })),
      },
    }));
    if (!editor.restoreDocumentBuffer || !editor.getDocumentRevision) throw new Error("Missing restore API");
    expect((await editor.restoreDocumentBuffer("historical", { expectedRevision: editor.getDocumentRevision() })).status).toBe("transaction-rejected");
    expect(cell.isConnected).toBe(true);
    expect((await editor.captureDocumentSnapshot()).markdown).toContain("pending");
    await registration.dispose();
    input(cell, "continued after no-op");
    await blur(cell);
    expect(editor.getDocument()).toContain("continued after no-op");
  });
});
