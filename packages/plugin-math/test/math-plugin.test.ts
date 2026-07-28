import { describe, expect, it } from "vitest";

import { createMathPlugin, type MathPluginOptions } from "../src/index";

describe("createMathPlugin", () => {
  it("returns a valid NexusPlugin with the expected name", () => {
    const plugin = createMathPlugin();
    expect(plugin.name).toBe("plugin-math");
  });

  it("registers remark-math as a remark plugin", () => {
    const plugin = createMathPlugin();
    expect(plugin.remarkPlugins).toBeDefined();
    expect(plugin.remarkPlugins).toHaveLength(1);
  });

  it("registers block math and inlineMath widgets", () => {
    const plugin = createMathPlugin();
    expect(plugin.widgets).toBeDefined();
    expect(plugin.widgets).toHaveLength(2);
    expect(plugin.widgets![0].nodeType).toBe("math");
    expect(plugin.widgets![1].nodeType).toBe("inlineMath");
  });

  it("accepts an empty options object without changing defaults", () => {
    const plugin = createMathPlugin({});
    expect(plugin.name).toBe("plugin-math");
  });

  it("stores errorOnInvalid: true without throwing", () => {
    const plugin = createMathPlugin({ errorOnInvalid: true });
    expect(plugin.name).toBe("plugin-math");
  });

  it("block widget renders invalid formula as raw source when errorOnInvalid is true", () => {
    const plugin = createMathPlugin({ errorOnInvalid: true });
    const widget = plugin.widgets!.find((w) => w.nodeType === "math")!;
    expect(widget).toBeDefined();

    // Simulate an invalid KaTeX formula
    const container = widget.render(
      { type: "math", value: "\\invalid{", position: { start: { offset: 0 }, end: { offset: 10 } } } as any,
      "\\invalid{"
    );

    // When throwOnError is true, KaTeX throws → fallback to raw source
    expect(container).toBeInstanceOf(HTMLDivElement);
    // The container should fall back to source text if KaTeX fails
    expect(container.textContent).toContain("\\invalid{");
  });

  it("block widget renders KaTeX output without throwing with defaults", () => {
    const plugin = createMathPlugin();
    const widget = plugin.widgets!.find((w) => w.nodeType === "math")!;
    expect(widget).toBeDefined();

    // Even with invalid input, default throwOnError: false should not throw
    expect(() => {
      widget.render(
        { type: "math", value: "\\invalid{", position: { start: { offset: 0 }, end: { offset: 10 } } } as any,
        "\\invalid{"
      );
    }).not.toThrow();
  });

  it("inlineMath widget handles valid KaTeX input", () => {
    const plugin = createMathPlugin();
    const widget = plugin.widgets!.find((w) => w.nodeType === "inlineMath")!;
    expect(widget).toBeDefined();

    // Valid inline formula
    const span = widget.render(
      { type: "inlineMath", value: "x^2", position: { start: { offset: 0 }, end: { offset: 3 } } } as any,
      "x^2"
    ) as HTMLElement;
    expect(span).toBeInstanceOf(HTMLSpanElement);
    // KaTeX renders at least one span inside
    expect(span.innerHTML.length).toBeGreaterThan(0);
  });
});