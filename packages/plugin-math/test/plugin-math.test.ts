import katex from "katex";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WidgetDefinition, WidgetRenderContext } from "@floatboat/nexus-core";

import { createMathPlugin } from "../src/index";

function getWidget(nodeType: "math" | "inlineMath"): WidgetDefinition {
  const widget = createMathPlugin().widgets?.find((candidate) => candidate.nodeType === nodeType);

  if (!widget) {
    throw new Error(`Missing ${nodeType} widget`);
  }

  return widget;
}

function createContext(overrides: Partial<WidgetRenderContext> = {}): WidgetRenderContext {
  return {
    from: 12,
    to: 24,
    setSelection: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@floatboat/nexus-plugin-math", () => {
  it("registers remark-math and block/inline widgets", () => {
    const plugin = createMathPlugin();
    const block = getWidget("math");
    const inline = getWidget("inlineMath");

    expect(plugin.name).toBe("plugin-math");
    expect(plugin.remarkPlugins).toHaveLength(1);
    expect(block.block).toBe(true);
    expect(block.ignoreEvents).toBe(true);
    expect(inline.block).toBe(false);
    expect(inline.ignoreEvents).toBe(false);
  });

  it("renders block math with KaTeX display markup", () => {
    const element = getWidget("math").render(
      { type: "math", value: "x^2 + y^2 = z^2" },
      "$$x^2 + y^2 = z^2$$"
    );

    expect(element.className).toBe("nexus-math-display");
    expect(element.querySelector(".katex-display")).not.toBeNull();
    expect(element.textContent).toContain("x");
  });

  it("renders inline math without display-mode markup", () => {
    const element = getWidget("inlineMath").render(
      { type: "inlineMath", value: "E = mc^2" },
      "$E = mc^2$"
    );

    expect(element.className).toBe("nexus-math-inline");
    expect(element.querySelector(".katex")).not.toBeNull();
    expect(element.querySelector(".katex-display")).toBeNull();
  });

  it("renders invalid formulas as KaTeX errors without throwing", () => {
    const render = () => getWidget("inlineMath").render(
      { type: "inlineMath", value: String.raw`\unknownCommand{` },
      String.raw`$\unknownCommand{$`
    );

    expect(render).not.toThrow();
    expect(render().querySelector(".katex-error")).not.toBeNull();
  });

  it("falls back to source text when KaTeX itself throws", () => {
    vi.spyOn(katex, "render").mockImplementation(() => {
      throw new Error("render failed");
    });

    const block = getWidget("math").render({ type: "math" }, "block source");
    const inline = getWidget("inlineMath").render({ type: "inlineMath" }, "inline source");

    expect(block.textContent).toBe("block source");
    expect(inline.textContent).toBe("inline source");
  });

  it("omits the block edit button when no render context is available", () => {
    const element = getWidget("math").render({ type: "math", value: "x" }, "$$x$$");

    expect(element.querySelector("button")).toBeNull();
  });

  it("uses the block edit button to reveal source and focus the editor", () => {
    const context = createContext();
    const element = getWidget("math").render(
      { type: "math", value: "x" },
      "$$x$$",
      context
    );
    const button = element.querySelector<HTMLButtonElement>('button[aria-label="Edit formula"]');

    expect(button).not.toBeNull();
    button?.click();
    expect(context.setSelection).toHaveBeenCalledOnce();
    expect(context.setSelection).toHaveBeenCalledWith(12);
    expect(context.focus).toHaveBeenCalledOnce();
  });

  it("reveals the block edit button for pointer hover and keyboard focus", () => {
    const element = getWidget("math").render(
      { type: "math", value: "x" },
      "$$x$$",
      createContext()
    );
    const button = element.querySelector<HTMLButtonElement>('button[aria-label="Edit formula"]');

    expect(button?.style.opacity).toBe("0");

    element.dispatchEvent(new MouseEvent("mouseenter"));
    expect(button?.style.opacity).toBe("1");
    element.dispatchEvent(new MouseEvent("mouseleave"));
    expect(button?.style.opacity).toBe("0");

    button?.dispatchEvent(new FocusEvent("focus"));
    expect(button?.style.opacity).toBe("1");
    button?.dispatchEvent(new FocusEvent("blur"));
    expect(button?.style.opacity).toBe("0");
  });

  it("keeps block edit-button events out of the widget body", () => {
    const context = createContext();
    const element = getWidget("math").render(
      { type: "math", value: "x" },
      "$$x$$",
      context
    );
    const button = element.querySelector<HTMLButtonElement>("button");
    const bubbled = vi.fn();
    element.addEventListener("mousedown", bubbled);

    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
  });
});
