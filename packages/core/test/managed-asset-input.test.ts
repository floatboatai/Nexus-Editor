import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createEditor, type AssetInputEvent, type EditorAPI, type EditorConfig } from "../src/index";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Uninitialized deferred"); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(config: Partial<EditorConfig> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const events: AssetInputEvent[] = [];
  const editor = createEditor({
    container, initialValue: "abcd", plugins: [createGfmPreset(), createHistoryPlugin()],
    assetInput: { managed: true, onEvent: (event) => events.push(event) }, ...config,
  });
  editors.push(editor);
  const root = container.querySelector<HTMLElement>(".cm-editor");
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!root || !content) throw new Error("Missing editor");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("Missing view");
  return { editor, container, content, view, events };
}

function transfer(target: HTMLElement, files: File[], kind: "paste" | "drop" = "paste") {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, kind === "paste" ? "clipboardData" : "dataTransfer", { value: { files } });
  if (kind === "drop") Object.defineProperties(event, { clientX: { value: 18 }, clientY: { value: 24 } });
  target.dispatchEvent(event);
  return event;
}

const picture = (name = "a.png") => new File(["picture"], name, { type: "image/png" });

describe("managed asset input", () => {
  it("preserves one-argument legacy uploads and supports explicit managed cancellation", async () => {
    const legacyUpload = vi.fn(async () => "legacy.png");
    const legacy = setup({ assetInput: undefined, onAssetUpload: legacyUpload });
    const file = picture();
    await legacy.editor.uploadAsset(file);
    expect(legacyUpload).toHaveBeenCalledWith(file);
    const managed = setup({ onAssetUpload: () => new Promise(() => undefined) });
    transfer(managed.content, [file]);
    managed.editor.cancelAssetInput?.(managed.events[0].operationId);
    await vi.waitFor(() => expect(managed.events.at(-1)?.status).toBe("cancelled"));
    expect(managed.editor.getDocument()).toBe("abcd");
  });

  it("ends all-failed operations and rejects unsafe references", async () => {
    const { editor, content, events } = setup({ onAssetUpload: async () => "javascript:alert(1)" });
    transfer(content, [picture()]);
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: "failed", completed: 1, total: 1 }));
    expect(editor.getDocument()).toBe("abcd");
  });

  it("maps the captured range instead of following the current selection", async () => {
    const pending = deferred<string>();
    const { editor, content, events } = setup({ onAssetUpload: () => pending.promise });
    editor.setSelection(2);
    expect(transfer(content, [picture()]).defaultPrevented).toBe(true);
    editor.setSelection(4);
    editor.replaceRange(0, 0, "X");
    pending.resolve("_assets/a.png");
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("inserted"));
    expect(editor.getDocument()).toBe("Xab![a.png](_assets/a.png)cd");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("Xabcd");
  });

  it("uses the drop position and inserts successful files together in order", async () => {
    const upload = vi.fn(async (file: File) => file.name === "bad.png" ? null : `images/${file.name}`);
    const { editor, content, view, events } = setup({ onAssetUpload: upload });
    const coords = vi.spyOn(view, "posAtCoords").mockReturnValue(1);
    editor.setSelection(4);
    transfer(content, [picture("a (1).png"), picture("bad.png"), picture("b.png")], "drop");
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("inserted"));
    expect(coords).toHaveBeenCalledWith({ x: 18, y: 24 });
    expect(editor.getDocument()).toBe("a![a (1).png](images/a%20%281%29.png)\n![b.png](images/b.png)bcd");
    expect(events.some((event) => event.status === "failed")).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("abcd");
  });

  it.each(["edit", "replace", "destroy"] as const)("cancels on %s and ignores late uploads", async (action) => {
    const pending = deferred<string>();
    const upload = vi.fn(() => pending.promise);
    const { editor, content, events } = setup({ onAssetUpload: upload });
    editor.setSelection(1, 3);
    transfer(content, [picture()]);
    if (action === "edit") editor.replaceRange(1, 2, "X");
    else if (action === "replace") editor.setDocument("new document");
    else editor.destroy();
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("cancelled"));
    pending.resolve("images/a.png");
    await Promise.resolve();
    expect(editor.getDocument()).not.toContain("![");
  });

  it("honors typed bubble hooks before the fallback without dispatching them twice", async () => {
    const upload = vi.fn(async () => "a.png");
    const { editor, content } = setup({ onAssetUpload: upload });
    const consume = vi.fn(() => "consume" as const);
    editor.getContributionSink().registerDomEvent("consumer", "paste", consume, { phase: "bubble" });
    transfer(content, [picture()]);
    await Promise.resolve();
    expect(consume).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
    expect(editor.getDocument()).toBe("abcd");
  });

  it("does not upload to read-only editors or fall back from unsupported widgets", async () => {
    const upload = vi.fn(async () => "a.png");
    const readOnly = setup({ readOnly: true, onAssetUpload: upload });
    transfer(readOnly.content, [picture()]);
    expect(readOnly.events.at(-1)?.code).toBe("read-only");
    const { content, events } = setup({ onAssetUpload: upload });
    const widget = document.createElement("div");
    widget.dataset.nexusWidget = "external";
    content.append(widget);
    transfer(widget, [picture()]);
    expect(events.at(-1)?.code).toBe("unsupported-target");
    expect(upload).not.toHaveBeenCalled();
  });

  it("cancels a captured third-party target when its registration is revoked", async () => {
    const { editor, content, events } = setup({ onAssetUpload: () => new Promise(() => undefined) });
    const widget = document.createElement("div");
    widget.dataset.nexusWidget = "custom";
    content.append(widget);
    const replace = vi.fn(() => true);
    const registration = editor.getContributionSink().registerInputTarget("custom", widget, {
      kind: "widget", getSelectedText: () => "", replaceSelection: replace,
      captureSelection: () => ({ isValid: () => true, replaceSelection: replace, dispose() {} }),
    });
    transfer(widget, [picture()]);
    await registration.dispose();
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("cancelled"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("captures a table caret and keeps later cell edits after the upload", async () => {
    const pending = deferred<string>();
    const original = "| A | B |\n| --- | --- |\n| 1 | old |";
    const { editor, container, events } = setup({ initialValue: original, livePreview: true, onAssetUpload: () => pending.promise });
    const cell = Array.from(container.querySelectorAll<HTMLElement>(".nexus-cell")).at(-1);
    if (!cell) throw new Error("Missing table cell");
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    cell.tabIndex = -1;
    cell.focus();
    if (!cell.firstChild) throw new Error("Missing cell text");
    const range = document.createRange();
    range.setStart(cell.firstChild, 1);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    transfer(cell, [picture()]);
    pending.resolve("images/a.png");
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("inserted"));
    expect(editor.getDocument()).toContain("| 1 | o![a.png](images/a.png)ld |");
    expect(document.activeElement).toBe(cell);
    cell.textContent += " continued";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    cell.blur();
    await Promise.resolve();
    expect(editor.getDocument()).toContain("o![a.png](images/a.png)ld continued");
  });

  it("contains failures from a captured target's validation and cleanup", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { editor, content, events } = setup({ onAssetUpload: () => new Promise(() => undefined) });
    const widget = document.createElement("div");
    widget.dataset.nexusWidget = "custom";
    content.append(widget);
    const replace = vi.fn(() => true);
    const cleanup = vi.fn(() => { throw new Error("Target cleanup failed"); });
    editor.getContributionSink().registerInputTarget("custom", widget, {
      kind: "widget", getSelectedText: () => "", replaceSelection: replace,
      captureSelection: () => ({
        isValid: () => { throw new Error("Target validation failed"); },
        replaceSelection: replace, dispose: cleanup,
      }),
    });
    transfer(widget, [picture()]);
    widget.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("cancelled"));
    expect(replace).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("Nexus asset input cleanup failed");
  });
});
