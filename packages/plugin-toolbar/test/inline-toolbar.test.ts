import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createInlineToolbarUI, type InlineToolbarUI } from "../src/inline-toolbar";

interface Harness {
  editor: EditorAPI;
  toolbar: InlineToolbarUI;
  container: HTMLDivElement;
  destroy(): void;
}

function setup(
  options: Parameters<typeof createInlineToolbarUI>[1] = {}
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "hello world",
  });
  const toolbar = createInlineToolbarUI(editor, options);

  return {
    editor,
    toolbar,
    container,
    destroy() {
      toolbar.destroy();
      editor.destroy();
      container.remove();
    },
  };
}

function select(editor: EditorAPI, from: number, to: number = from): void {
  editor.setSelection(from, to);
}

function buttons(toolbar: InlineToolbarUI): HTMLButtonElement[] {
  return Array.from(toolbar.element.querySelectorAll<HTMLButtonElement>("button"));
}

function buttonIds(toolbar: InlineToolbarUI): string[] {
  return buttons(toolbar).map((b) => b.dataset.inlineToolbarAction ?? "");
}

function pressKey(key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
  return e;
}

const ICON_SPAN = (): HTMLElement => document.createElement("span");

describe("createInlineToolbarUI lifecycle", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("mounts hidden by default", () => {
    h = setup();
    expect(h.toolbar.element.parentElement).toBe(document.body);
    expect(h.toolbar.element.style.display).toBe("none");
  });

  it("shows when the user selects a non-empty range", () => {
    h = setup();
    select(h.editor, 0, 5); // "hello"
    expect(h.toolbar.element.style.display).toBe("flex");
  });

  it("hides when the selection collapses", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(h.toolbar.element.style.display).toBe("flex");
    select(h.editor, 0); // collapsed caret
    expect(h.toolbar.element.style.display).toBe("none");
  });

  it("destroy detaches the element and stops reacting", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(h.toolbar.element.parentElement).toBe(document.body);
    h.toolbar.destroy();
    expect(h.toolbar.element.parentElement).toBeNull();
    // Should be safe to dispatch more selection events without throwing.
    expect(() => select(h.editor, 0, 5)).not.toThrow();
  });

  it("destroy is idempotent", () => {
    h = setup();
    expect(() => {
      h.toolbar.destroy();
      h.toolbar.destroy();
    }).not.toThrow();
  });

  it("supports a custom container", () => {
    const customRoot = document.createElement("div");
    document.body.appendChild(customRoot);
    h = setup({ container: customRoot });
    expect(h.toolbar.element.parentElement).toBe(customRoot);
    customRoot.remove();
  });
});

describe("createInlineToolbarUI default groups", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("renders the inline-only default buttons", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(buttonIds(h.toolbar)).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "inline-code",
      "link",
    ]);
  });

  it("toggling bold wraps the selection", () => {
    h = setup();
    select(h.editor, 0, 5);
    const boldBtn = buttons(h.toolbar).find(
      (b) => b.dataset.inlineToolbarAction === "bold"
    )!;
    boldBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    boldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(h.editor.getDocument()).toBe("**hello** world");
  });

  it("toggling italic wraps the selection", () => {
    h = setup();
    select(h.editor, 6, 11); // "world"
    const italicBtn = buttons(h.toolbar).find(
      (b) => b.dataset.inlineToolbarAction === "italic"
    )!;
    italicBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    italicBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(h.editor.getDocument()).toBe("hello *world*");
  });
});

describe("createInlineToolbarUI custom groups", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("renders custom buttons in order", () => {
    const action = vi.fn();
    h = setup({
      groups: [
        {
          buttons: [
            { id: "x", title: "X", icon: ICON_SPAN, action },
            { id: "y", title: "Y", icon: ICON_SPAN, action },
          ],
        },
        {
          buttons: [{ id: "z", title: "Z", icon: ICON_SPAN, action }],
        },
      ],
    });
    select(h.editor, 0, 5);
    expect(buttonIds(h.toolbar)).toEqual(["x", "y", "z"]);
    // A separator should sit between the two groups.
    const sep = h.toolbar.element.querySelector(".nexus-inline-toolbar-separator");
    expect(sep).not.toBeNull();
  });

  it("clicking a button invokes its action with the editor", () => {
    const action = vi.fn();
    h = setup({
      groups: [{ buttons: [{ id: "x", title: "X", icon: ICON_SPAN, action }] }],
    });
    select(h.editor, 0, 5);
    const [btn] = buttons(h.toolbar);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(h.editor);
  });

  it("mousedown on a button does not steal focus from the editor", () => {
    const action = vi.fn();
    h = setup({
      groups: [{ buttons: [{ id: "x", title: "X", icon: ICON_SPAN, action }] }],
    });
    select(h.editor, 0, 5);
    const [btn] = buttons(h.toolbar);
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("applies a custom class prefix", () => {
    h = setup({
      classPrefix: "my-toolbar",
      groups: [{ buttons: [{ id: "x", title: "X", icon: ICON_SPAN, action: () => {} }] }],
    });
    expect(h.toolbar.element.classList.contains("my-toolbar")).toBe(true);
    const btn = buttons(h.toolbar)[0];
    expect(btn.classList.contains("my-toolbar-btn")).toBe(true);
  });
});

describe("createInlineToolbarUI dismissal", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("Escape dismisses the toolbar", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(h.toolbar.element.style.display).toBe("flex");
    const e = pressKey("Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(h.toolbar.element.style.display).toBe("none");
  });

  it("after Escape, re-selecting shows the toolbar again", () => {
    h = setup();
    select(h.editor, 0, 5);
    pressKey("Escape");
    expect(h.toolbar.element.style.display).toBe("none");
    // Re-select a different range — the dismiss latch should reset.
    select(h.editor, 6, 11);
    expect(h.toolbar.element.style.display).toBe("flex");
  });

  it("Escape does nothing when the toolbar is hidden", () => {
    h = setup();
    const e = pressKey("Escape");
    expect(e.defaultPrevented).toBe(false);
  });

  it("mousedown outside the toolbar dismisses it", () => {
    h = setup();
    select(h.editor, 0, 5);
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(h.toolbar.element.style.display).toBe("none");
    elsewhere.remove();
  });

  it("mousedown inside the toolbar does not dismiss it", () => {
    h = setup();
    select(h.editor, 0, 5);
    const btn = buttons(h.toolbar)[0];
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(h.toolbar.element.style.display).toBe("flex");
  });

  // Note: editor blur dismissal is implemented via `editor.on("blur", ...)`
  // in inline-toolbar.ts but is not unit-tested here — jsdom does not
  // synchronously emit CM6's blur observer callback on `editor.blur()`,
  // mirroring the same limitation that kept `plugin-slash`'s menu-ui
  // tests from covering blur. The behavior is verified manually in the
  // electron demo.
});

describe("createInlineToolbarUI composition", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("does not show during IME composition", () => {
    h = setup();
    document.dispatchEvent(new Event("compositionstart"));
    select(h.editor, 0, 5);
    expect(h.toolbar.element.style.display).toBe("none");
    document.dispatchEvent(new Event("compositionend"));
    // After compositionend, a fresh selection re-shows the toolbar.
    select(h.editor, 6, 11);
    expect(h.toolbar.element.style.display).toBe("flex");
  });

  it("hides a visible toolbar when composition starts", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(h.toolbar.element.style.display).toBe("flex");
    document.dispatchEvent(new Event("compositionstart"));
    expect(h.toolbar.element.style.display).toBe("none");
  });
});

describe("createInlineToolbarUI viewport changes", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("repositions on window resize without throwing", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(() => {
      window.dispatchEvent(new Event("resize"));
    }).not.toThrow();
    expect(h.toolbar.element.style.display).toBe("flex");
  });

  it("repositions on window scroll without throwing", () => {
    h = setup();
    select(h.editor, 0, 5);
    expect(() => {
      window.dispatchEvent(new Event("scroll"));
    }).not.toThrow();
    expect(h.toolbar.element.style.display).toBe("flex");
  });
});
