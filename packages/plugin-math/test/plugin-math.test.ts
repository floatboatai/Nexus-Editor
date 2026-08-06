import { describe, it, expect, vi } from "vitest";
import { createMathPlugin } from "../src/index";
import type { WidgetRenderContext } from "@floatboat/nexus-core";

// A minimal mock of the widget render context. The block-math edit button
// calls `setSelection(from)` + `focus()` when clicked, so we spy on those.
function makeCtx(from = 0): WidgetRenderContext {
  return {
    from,
    setSelection: vi.fn(),
    focus: vi.fn(),
  } as unknown as WidgetRenderContext;
}

describe("createMathPlugin", () => {
  it("exposes the expected plugin shape", () => {
    const plugin = createMathPlugin();
    expect(plugin.name).toBe("plugin-math");
    expect(Array.isArray(plugin.widgets)).toBe(true);
    expect(plugin.widgets).toHaveLength(2);

    const block = plugin.widgets.find((w) => w.nodeType === "math");
    const inline = plugin.widgets.find((w) => w.nodeType === "inlineMath");
    expect(block).toBeDefined();
    expect(block!.block).toBe(true);
    expect(inline).toBeDefined();
    expect(inline!.block).toBe(false);

    // remark-math must be wired so $...$ and $$...$$ parse into nodes
    expect(plugin.remarkPlugins?.length).toBeGreaterThan(0);
  });

  it("renders block math into a centered .nexus-math-display with KaTeX", () => {
    const plugin = createMathPlugin();
    const block = plugin.widgets.find((w) => w.nodeType === "math")!;
    const el = block.render({ value: "x^2" }, "x^2") as HTMLElement;
    expect(el.className).toBe("nexus-math-display");
    expect(el.querySelector(".katex")).not.toBeNull();
    // displayMode: true produces the block-level KaTeX wrapper
    expect(el.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders inline math into .nexus-math-inline without a display wrapper", () => {
    const plugin = createMathPlugin();
    const inline = plugin.widgets.find((w) => w.nodeType === "inlineMath")!;
    const el = inline.render({ value: "a+b" }, "a+b") as HTMLElement;
    expect(el.className).toBe("nexus-math-inline");
    expect(el.querySelector(".katex")).not.toBeNull();
    // inline math must stay in the paragraph's line box
    expect(el.querySelector(".katex-display")).toBeNull();
  });

  it("does not attach the edit button when no render context is given", () => {
    const plugin = createMathPlugin();
    const block = plugin.widgets.find((w) => w.nodeType === "math")!;
    const el = block.render({ value: "x^2" }, "x^2") as HTMLElement;
    expect(el.querySelector("button")).toBeNull();
  });

  it("attaches a clickable edit button when a render context is given", () => {
    const plugin = createMathPlugin();
    const block = plugin.widgets.find((w) => w.nodeType === "math")!;
    const ctx = makeCtx(5);
    const el = block.render({ value: "x^2" }, "x^2", ctx) as HTMLElement;
    const btn = el.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("Edit formula");

    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.setSelection).toHaveBeenCalledWith(5);
    expect(ctx.focus).toHaveBeenCalled();
  });

  it("does not throw on malformed math input", () => {
    const plugin = createMathPlugin();
    const block = plugin.widgets.find((w) => w.nodeType === "math")!;
    expect(
      () => block.render({ value: "\\frac{" }, "\\frac{") as HTMLElement,
    ).not.toThrow();
  });
});
