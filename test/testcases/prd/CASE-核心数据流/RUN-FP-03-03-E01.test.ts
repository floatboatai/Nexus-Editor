import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "# Heading\n\n[link](https://example.com)",
    // 不传 livePreview（默认 undefined = 不启用装饰扩展）
    parseDelayMs: 0,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  return { container, docs, editor };
}

describe("FP-03-03-E01: livePreview=false（未开启）时无任何装饰，源码直显", () => {
  it("步骤1-4: 无装饰 DOM、源码直显、数据流完整", () => {
    const { container, docs, editor } = setup();
    expect(container.querySelector("[data-heading-level]")).toBeNull();
    expect(container.querySelector("[data-link-url]")).toBeNull();
    expect(container.textContent).toContain("# Heading");
    expect(container.textContent).toContain("[link](https://example.com)");
    expect(editor.getAst().children[0]?.type).toBe("heading");
    editor.setDocument("# New");
    expect(docs.length).toBeGreaterThan(0);
    editor.destroy();
  });
});
