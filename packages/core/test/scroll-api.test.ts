import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";
import type { EditorAPI, ScrollInfo } from "../src/index";

function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("EditorAPI scroll APIs", () => {
  let container: HTMLElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  describe("getScrollInfo", () => {
    it("returns a ScrollInfo-shaped object even before layout", () => {
      editor = createEditor({ container, initialValue: "hello world" });
      const info = editor.getScrollInfo();

      expect(info).toEqual(
        expect.objectContaining({
          scrollTop: expect.any(Number),
          scrollHeight: expect.any(Number),
          clientHeight: expect.any(Number),
          topPos: expect.any(Number),
          bottomPos: expect.any(Number),
        })
      );
    });

    it("returns a zero-filled snapshot after destroy", () => {
      editor = createEditor({ container, initialValue: "hello" });
      editor.destroy();

      expect(editor.getScrollInfo()).toEqual({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        topPos: 0,
        bottomPos: 0,
      });
    });

    it("keeps topPos and bottomPos within document bounds", () => {
      const doc = "line one\nline two\nline three";
      editor = createEditor({ container, initialValue: doc });
      const info = editor.getScrollInfo();

      expect(info.topPos).toBeGreaterThanOrEqual(0);
      expect(info.bottomPos).toBeLessThanOrEqual(doc.length);
      expect(info.topPos).toBeLessThanOrEqual(info.bottomPos);
    });
  });

  describe("getVisibleRange", () => {
    it("returns a { from, to } range aligned with getScrollInfo", () => {
      editor = createEditor({ container, initialValue: "some content" });
      const info = editor.getScrollInfo();
      const range = editor.getVisibleRange();

      expect(range).toEqual({ from: info.topPos, to: info.bottomPos });
    });

    it("returns { from: 0, to: 0 } after destroy", () => {
      editor = createEditor({ container });
      editor.destroy();
      expect(editor.getVisibleRange()).toEqual({ from: 0, to: 0 });
    });
  });

  describe("scrollPosIntoView", () => {
    it("accepts a document offset without throwing", () => {
      editor = createEditor({ container, initialValue: "a\nb\nc\nd\ne" });
      expect(() => editor.scrollPosIntoView(0)).not.toThrow();
      expect(() => editor.scrollPosIntoView(4)).not.toThrow();
    });

    it("accepts all documented align options", () => {
      editor = createEditor({ container, initialValue: "hello" });
      expect(() => editor.scrollPosIntoView(0, { align: "start" })).not.toThrow();
      expect(() => editor.scrollPosIntoView(0, { align: "center" })).not.toThrow();
      expect(() => editor.scrollPosIntoView(0, { align: "end" })).not.toThrow();
      expect(() => editor.scrollPosIntoView(0, { align: "nearest" })).not.toThrow();
    });

    it("is a no-op after destroy", () => {
      editor = createEditor({ container, initialValue: "hello" });
      editor.destroy();
      expect(() => editor.scrollPosIntoView(0)).not.toThrow();
    });
  });

  describe("scroll event", () => {
    it("fires when the scroll container scrolls", async () => {
      editor = createEditor({ container, initialValue: "content" });
      const handler = vi.fn<(info: ScrollInfo) => void>();
      editor.on("scroll", handler);

      // In jsdom the CM6 scrollDOM has no real geometry; we dispatch the
      // native scroll event to simulate a user scroll — the event handler
      // itself is what we're testing (rAF-coalesced emit path).
      const scrollDOM = container.querySelector(".cm-scroller") as HTMLElement;
      expect(scrollDOM).toBeTruthy();
      scrollDOM.dispatchEvent(new Event("scroll"));

      await waitFrame();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          scrollTop: expect.any(Number),
          scrollHeight: expect.any(Number),
          clientHeight: expect.any(Number),
        })
      );
    });

    it("coalesces bursts of scroll events to one emit per animation frame", async () => {
      editor = createEditor({ container, initialValue: "content" });
      const handler = vi.fn();
      editor.on("scroll", handler);

      const scrollDOM = container.querySelector(".cm-scroller") as HTMLElement;
      // Fire 10 scroll events synchronously — they should collapse to one emit.
      for (let i = 0; i < 10; i++) {
        scrollDOM.dispatchEvent(new Event("scroll"));
      }
      await waitFrame();

      expect(handler).toHaveBeenCalledOnce();
    });

    it("does not fire after destroy", async () => {
      editor = createEditor({ container, initialValue: "content" });
      const handler = vi.fn();
      editor.on("scroll", handler);

      const scrollDOM = container.querySelector(".cm-scroller") as HTMLElement;
      editor.destroy();
      scrollDOM.dispatchEvent(new Event("scroll"));
      await waitFrame();

      expect(handler).not.toHaveBeenCalled();
    });

    it("can be removed with off()", async () => {
      editor = createEditor({ container, initialValue: "content" });
      const handler = vi.fn();
      editor.on("scroll", handler);
      editor.off("scroll", handler);

      const scrollDOM = container.querySelector(".cm-scroller") as HTMLElement;
      scrollDOM.dispatchEvent(new Event("scroll"));
      await waitFrame();

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
