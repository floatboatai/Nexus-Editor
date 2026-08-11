import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-B01: link inclusiveEnd：光标落在 range.to 处展开、to+1 处折叠", () => {
  it("步骤1-3: 右边界展开、范围外折叠", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Click [here](https://example.com) now\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // link 范围: from=6, to=33
    const linkTo = source.indexOf(")") + 1; // 33

    // 步骤1: 光标在右边界 to=33（inclusiveEnd=true）→ 展开
    editor.setSelection(linkTo);
    expect(container.textContent ?? "").toContain("[here](https://example.com)");
    expect(container.querySelector("[data-link-url]")).toBeNull();
    // 步骤2: 光标移到 to+1=34（link 范围外）
    editor.setSelection(linkTo + 1);
    expect(editor.getSelection().anchor).toBe(34);
    // 步骤3: 范围外 → 重新折叠为 widget
    expect(container.querySelector("[data-link-url]")).not.toBeNull();
    expect(container.textContent ?? "").not.toContain("[here](");

    editor.destroy();
    container.remove();
  });
});
