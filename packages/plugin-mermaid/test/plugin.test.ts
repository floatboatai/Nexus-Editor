import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";

// ---------------------------------------------------------------------------
// Mock mermaid — jsdom has no real SVG renderer, so we control render() per
// test. The hoisted factory runs before imports, so `createMermaidPlugin`
// gets the mocked module transparently.
// ---------------------------------------------------------------------------

const { mockedRender } = vi.hoisted(() => ({
  mockedRender: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mockedRender,
  },
}));

import { createMermaidPlugin, reconfigureMermaid } from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MMERMAID = "graph TD\n  A --> B";

function mermaidDoc(source: string): string {
  return "```mermaid\n" + source + "\n```";
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("createMermaidPlugin", () => {
  it("returns a NexusPlugin with the correct name", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.name).toBe("plugin-mermaid");
  });

  it("returns a NexusPlugin with one widget definition", () => {
    const plugin = createMermaidPlugin();
    expect(plugin.widgets).toHaveLength(1);
  });

  it("accepts theme option without throwing", () => {
    expect(() => createMermaidPlugin({ theme: "dark" })).not.toThrow();
  });

  it("accepts custom mermaidConfig without throwing", () => {
    expect(() =>
      createMermaidPlugin({ mermaidConfig: { fontFamily: "monospace" } })
    ).not.toThrow();
  });
});

describe("Widget match logic", () => {
  it("matches a mermaid code block", () => {
    const plugin = createMermaidPlugin();
    const widget = plugin.widgets![0];
    const match = widget.match!;

    expect(match({ lang: "mermaid", value: VALID_MMERMAID })).toBe(true);
  });

  it("rejects a non-mermaid code block", () => {
    const plugin = createMermaidPlugin();
    const widget = plugin.widgets![0];
    const match = widget.match!;

    expect(match({ lang: "javascript", value: "console.log(1)" })).toBe(false);
  });

  it("rejects a code block with empty value", () => {
    const plugin = createMermaidPlugin();
    const widget = plugin.widgets![0];
    const match = widget.match!;

    expect(match({ lang: "mermaid", value: "" })).toBe(false);
  });

  it("rejects a code block with no value property", () => {
    const plugin = createMermaidPlugin();
    const widget = plugin.widgets![0];
    const match = widget.match!;

    expect(match({ lang: "mermaid" })).toBe(false);
  });
});

describe("Widget render (synchronous contract)", () => {
  let plugin: ReturnType<typeof createMermaidPlugin>;
  let widget: NonNullable<typeof plugin.widgets>[number];

  beforeEach(() => {
    mockedRender.mockClear();
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });
    plugin = createMermaidPlugin();
    widget = plugin.widgets![0];
  });

  it("always returns an HTMLElement synchronously", () => {
    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID)
    );
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it("shows a loading placeholder immediately", () => {
    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID)
    );
    expect(el.querySelector(".nexus-mermaid-loading")).not.toBeNull();
  });

  it("has the correct CSS class", () => {
    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID)
    );
    expect(el.className).toBe("nexus-mermaid-display");
  });
});

describe("Widget render — async SVG injection", () => {
  let plugin: ReturnType<typeof createMermaidPlugin>;
  let widget: NonNullable<typeof plugin.widgets>[number];

  beforeEach(() => {
    mockedRender.mockClear();
    plugin = createMermaidPlugin();
    widget = plugin.widgets![0];
  });

  it("eventually replaces the loading placeholder with SVG", async () => {
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });

    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID)
    );

    document.body.appendChild(el);
    await tick();

    expect(el.querySelector(".nexus-mermaid-loading")).toBeNull();
    expect(el.querySelector("svg")).not.toBeNull();

    document.body.removeChild(el);
  });

  it("shows an error message when render rejects", async () => {
    mockedRender.mockRejectedValue(new Error("Parse error"));

    const el = widget.render(
      { lang: "mermaid", value: "bad syntax" },
      mermaidDoc("bad syntax")
    );

    document.body.appendChild(el);
    await tick();

    expect(el.querySelector(".nexus-mermaid-error")).not.toBeNull();

    document.body.removeChild(el);
  });
});

describe("Widget destroy", () => {
  beforeEach(() => {
    mockedRender.mockClear();
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });
  });

  it("clears the element content", () => {
    const plugin = createMermaidPlugin();
    const widget = plugin.widgets![0];
    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID)
    );

    expect(el.innerHTML.length).toBeGreaterThan(0);
    widget.destroy!(el);
    expect(el.innerHTML).toBe("");
  });
});

describe("Edit button on rendered diagram", () => {
  let plugin: ReturnType<typeof createMermaidPlugin>;
  let widget: NonNullable<typeof plugin.widgets>[number];

  beforeEach(() => {
    mockedRender.mockClear();
    plugin = createMermaidPlugin();
    widget = plugin.widgets![0];
  });

  it("appends an edit button after SVG render", async () => {
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });

    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID),
      { from: 0, to: 50, setSelection: vi.fn(), focus: vi.fn() }
    );

    document.body.appendChild(el);
    await tick();

    const btn = el.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("Edit diagram");

    document.body.removeChild(el);
  });

  it("calls setSelection and focus when edit button is clicked", async () => {
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });

    const setSelection = vi.fn();
    const focus = vi.fn();

    const el = widget.render(
      { lang: "mermaid", value: VALID_MMERMAID },
      mermaidDoc(VALID_MMERMAID),
      { from: 10, to: 60, setSelection, focus }
    );

    document.body.appendChild(el);
    await tick();

    const btn = el.querySelector("button")!;
    btn.click();

    expect(setSelection).toHaveBeenCalledWith(10);
    expect(focus).toHaveBeenCalled();

    document.body.removeChild(el);
  });
});

describe("Integration with editor", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    mockedRender.mockClear();
    mockedRender.mockResolvedValue({ svg: "<svg></svg>" });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  it("editor initialises without throwing when mermaid plugin is attached", () => {
    const plugin = createMermaidPlugin();
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "# Hello\n\n```mermaid\ngraph TD\n  A --> B\n```\n",
        plugins: [plugin],
      });
    }).not.toThrow();
  });
});

describe("reconfigureMermaid", () => {
  it("changes theme without throwing", () => {
    expect(() => reconfigureMermaid({ theme: "dark" })).not.toThrow();
  });
});
