import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createPreviewPanel } from "../src/renderer/preview-panel";

// Regression guard: renderPreviewHtml emits plain <a href> elements, and this
// app's electron/main.ts has no will-navigate / setWindowOpenHandler guard.
// Left unhandled, clicking a preview link makes the whole BrowserWindow
// navigate away from the app. These tests pin that a plain click is always
// swallowed, and Ctrl/Cmd-click is the only way out (via window.open, same
// convention as the inline live-preview link renderer).
describe("createPreviewPanel — link click handling", () => {
  let editor: EditorAPI;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    editor = createEditor({ container, initialValue: "[click me](https://example.com)" });
  });

  afterEach(() => {
    editor.destroy();
  });

  it("prevents default navigation on a plain click and does not open externally", () => {
    const panel = createPreviewPanel(editor);
    const anchor = panel.element.querySelector("a[href]") as HTMLAnchorElement | null;
    expect(anchor).not.toBeNull();

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const notCancelled = anchor!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(notCancelled).toBe(false); // dispatchEvent returns false once preventDefault() is called
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
    panel.destroy();
  });

  it("opens externally via window.open on Ctrl/Cmd-click", () => {
    const panel = createPreviewPanel(editor);
    const anchor = panel.element.querySelector("a[href]") as HTMLAnchorElement | null;
    expect(anchor).not.toBeNull();

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));

    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

    openSpy.mockRestore();
    panel.destroy();
  });

  it("does not call window.open for a non-absolute href on Ctrl/Cmd-click", () => {
    // Regression: [[Some Note]] wiki-link syntax isn't a real mdast node, and
    // the underlying adapter's unresolved-shortcut-link fallback (see
    // design.md) gives it a garbage href like "[Some Note]" — not an
    // absolute URL. Passing that straight to window.open() lets the browser
    // resolve it against the current page's own origin (the Vite dev server
    // in dev), silently opening a whole extra copy of this app in a new
    // window instead of doing nothing. Ctrl/Cmd-click on such a link must be
    // a no-op, not an attempt to "open" a same-origin path.
    const wikiEditor = createEditor({
      container: document.createElement("div"),
      initialValue: "See [[Some Note]] for details.",
    });
    const panel = createPreviewPanel(wikiEditor);
    const anchor = panel.element.querySelector("a[href]") as HTMLAnchorElement | null;
    expect(anchor).not.toBeNull();
    // Sanity: confirm this test actually exercises a non-absolute href —
    // `new URL(href)` with no base throws for anything that isn't already
    // an absolute URL.
    expect(() => new URL(anchor!.getAttribute("href")!)).toThrow();

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));

    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
    panel.destroy();
    wikiEditor.destroy();
  });

  it("ignores clicks that don't land on a link", () => {
    const panel = createPreviewPanel(editor);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const notCancelled = panel.element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(notCancelled).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
    panel.destroy();
  });
});
