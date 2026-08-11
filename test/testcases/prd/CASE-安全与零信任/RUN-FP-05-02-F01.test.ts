import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });
  return { container, editor, openSpy };
}

describe("FP-05-02-F01: 点击行内外部链接触发 window.open 且携带 noopener 特性", () => {
  it("步骤1-4: mousedown 触发 window.open(url, _blank, noopener)", () => {
    const { container, editor, openSpy } = setup();
    editor.setSelection(editor.getDocument().length);

    const link = container.querySelector("[data-link-url]");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]).toEqual(["https://example.com", "_blank", "noopener"]);
    editor.destroy();
    openSpy.mockRestore();
  });
});
