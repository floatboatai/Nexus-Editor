import { describe, expect, it, vi } from "vitest";
import { createMermaidPlugin } from "../src/index";

// mermaid is an ESM module with async rendering; mock it so unit tests stay
// synchronous and don't require a real browser rendering pipeline.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'></svg>" }),
  },
}));

describe("createMermaidPlugin — plugin shape", () => {
  it("returns a NexusPlugin with the correct name", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.name).toBe("plugin-mermaid");
  });

  it("has exactly one widget definition", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.widgets).toHaveLength(1);
  });

  it("widget nodeType is 'code'", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.widgets![0].nodeType).toBe("code");
  });

  it("widget is a block widget", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.widgets![0].block).toBe(true);
  });

  it("widget ignores events (block-widget swallow pattern)", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.widgets![0].ignoreEvents).toBe(true);
  });
});

describe("createMermaidPlugin — widget.match", () => {
  it("matches nodes with lang='mermaid'", () => {
    const plugin = createMermaidPlugin();
    const match = plugin.widgets![0].match!;
    expect(match({ lang: "mermaid" })).toBe(true);
  });

  it("does NOT match nodes with lang='javascript'", () => {
    const plugin = createMermaidPlugin();
    const match = plugin.widgets![0].match!;
    expect(match({ lang: "javascript" })).toBe(false);
  });

  it("does NOT match nodes with lang='python'", () => {
    const plugin = createMermaidPlugin();
    const match = plugin.widgets![0].match!;
    expect(match({ lang: "python" })).toBe(false);
  });

  it("does NOT match nodes with no lang", () => {
    const plugin = createMermaidPlugin();
    const match = plugin.widgets![0].match!;
    expect(match({ lang: null })).toBe(false);
    expect(match({ lang: undefined })).toBe(false);
    expect(match({})).toBe(false);
  });

  it("does NOT match nodes with lang='MERMAID' (case-sensitive)", () => {
    const plugin = createMermaidPlugin();
    const match = plugin.widgets![0].match!;
    expect(match({ lang: "MERMAID" })).toBe(false);
  });
});

describe("createMermaidPlugin — widget.render", () => {
  it("returns an HTMLElement synchronously", () => {
    const plugin = createMermaidPlugin();
    const render = plugin.widgets![0].render;
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it("returned element has nexus-mermaid className", () => {
    const plugin = createMermaidPlugin();
    const render = plugin.widgets![0].render;
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    expect(el.classList.contains("nexus-mermaid")).toBe(true);
  });

  it("returned element has aria-label for accessibility", () => {
    const plugin = createMermaidPlugin();
    const render = plugin.widgets![0].render;
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    expect(el.getAttribute("aria-label")).toBe("Mermaid diagram");
  });

  it("shows a loading indicator before async render completes", () => {
    const plugin = createMermaidPlugin();
    const render = plugin.widgets![0].render;
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    // The loading child is present synchronously.
    const loading = el.querySelector(".nexus-mermaid-loading");
    expect(loading).not.toBeNull();
    expect(loading!.textContent).toBe("Rendering…");
  });

  it("does not throw when ctx is undefined", () => {
    const plugin = createMermaidPlugin();
    const render = plugin.widgets![0].render;
    expect(() => render({ value: "graph TD\nA-->B" }, "", undefined)).not.toThrow();
  });
});

describe("createMermaidPlugin — widget.destroy", () => {
  it("does not throw when called on the rendered element", () => {
    const plugin = createMermaidPlugin();
    const { render, destroy } = plugin.widgets![0];
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    expect(() => destroy?.(el)).not.toThrow();
  });

  it("marks the element as destroyed so async render skips mutation", () => {
    const plugin = createMermaidPlugin();
    const { render, destroy } = plugin.widgets![0];
    const el = render({ value: "graph TD\nA-->B" }, "graph TD\nA-->B", undefined);
    destroy?.(el);
    expect(el.dataset["nexusMermaidDestroyed"]).toBe("1");
  });
});

describe("createMermaidPlugin — slashCommands", () => {
  it("registers exactly one slash command", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.slashCommands).toHaveLength(1);
  });

  it("slash command id is 'mermaid'", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.slashCommands![0].id).toBe("mermaid");
  });

  it("slash command has a title and keywords", () => {
    const plugin = createMermaidPlugin();
    const cmd = plugin.slashCommands![0];
    expect(cmd.title).toBeTruthy();
    expect(cmd.keywords).toContain("mermaid");
    expect(cmd.keywords).toContain("diagram");
  });

  it("slash command run inserts a mermaid starter template and returns true", () => {
    const plugin = createMermaidPlugin();
    const cmd = plugin.slashCommands![0];
    const mockEditor = { replaceSelection: vi.fn() };
    const result = cmd.run!(mockEditor as any);
    expect(result).toBe(true);
    expect(mockEditor.replaceSelection).toHaveBeenCalledOnce();
    const inserted: string = mockEditor.replaceSelection.mock.calls[0][0];
    expect(inserted).toContain("```mermaid");
    expect(inserted).toContain("graph TD");
  });
});

describe("createMermaidPlugin — options", () => {
  it("accepts an explicit theme option without throwing", () => {
    expect(() => createMermaidPlugin({ theme: "dark" })).not.toThrow();
    expect(() => createMermaidPlugin({ theme: "neutral" })).not.toThrow();
    expect(() => createMermaidPlugin({ theme: "forest" })).not.toThrow();
  });

  it("works without any options (auto-detect theme)", () => {
    expect(() => createMermaidPlugin()).not.toThrow();
  });
});
