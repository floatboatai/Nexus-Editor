import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";

function getScroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".cm-scroller");
  if (!el) throw new Error("CM6 scroller element not found");
  return el as HTMLElement;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("scroll event", () => {
  it("emits { offset, ratio } in response to a native scroll", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "line\n".repeat(200) });
    const handler = vi.fn();
    editor.on("scroll", handler);

    getScroller(container).dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(handler).toHaveBeenCalled();
    const payload = handler.mock.calls[0][0];
    expect(typeof payload.offset).toBe("number");
    expect(typeof payload.ratio).toBe("number");
    expect(payload.ratio).toBeGreaterThanOrEqual(0);
    expect(payload.ratio).toBeLessThanOrEqual(1);

    editor.destroy();
    container.remove();
  });

  it("throttles rapid native scroll events to one emission per animation frame", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "line\n".repeat(200) });
    const handler = vi.fn();
    editor.on("scroll", handler);

    const scroller = getScroller(container);
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);

    editor.destroy();
    container.remove();
  });

  it("does not throw when no handler is registered", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "hello" });

    expect(() => getScroller(container).dispatchEvent(new Event("scroll"))).not.toThrow();
    await nextFrame();

    editor.destroy();
    container.remove();
  });

  it("stops listening after destroy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "hello" });
    const handler = vi.fn();
    editor.on("scroll", handler);

    const scroller = getScroller(container);
    editor.destroy();
    scroller.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(handler).not.toHaveBeenCalled();
    container.remove();
  });
});

describe("scrollToOffset", () => {
  it("does not throw for an in-range offset", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    expect(() => editor.scrollToOffset(5)).not.toThrow();

    editor.destroy();
  });

  it("clamps out-of-range offsets instead of throwing", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    expect(() => editor.scrollToOffset(9999)).not.toThrow();
    expect(() => editor.scrollToOffset(-10)).not.toThrow();

    editor.destroy();
  });

  it("is a no-op after destroy", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });
    editor.destroy();

    expect(() => editor.scrollToOffset(0)).not.toThrow();
  });
});
