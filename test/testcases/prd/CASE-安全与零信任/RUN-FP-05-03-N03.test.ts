import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "```js\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-N03: 多行代码内容原样完整保留", () => {
  it("步骤1-4: 三行代码全部按文本保留、顺序正确", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const text = container.textContent ?? "";
    expect(text).toContain("const a = 1;");
    expect(text).toContain("const b = 2;");
    expect(text).toContain("console.log(a + b);");
    const i1 = text.indexOf("const a = 1;");
    const i2 = text.indexOf("const b = 2;");
    const i3 = text.indexOf("console.log(a + b);");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    editor.destroy();
  });
});
