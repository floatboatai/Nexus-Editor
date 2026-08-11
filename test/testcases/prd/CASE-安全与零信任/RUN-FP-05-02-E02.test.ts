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
    initialValue: "正文 [危险](javascript:window.evil=true) 继续\n\nend",
    livePreview: true,
  });
  return { container, editor, openSpy };
}

describe("FP-05-02-E02: javascript: URL 行内链接点击不执行脚本", () => {
  it("步骤1-5: URL 存属性、window.open 按外部处理、脚本未执行", () => {
    const { container, editor, openSpy } = setup();
    editor.setSelection(editor.getDocument().length);

    const link = container.querySelector("[data-link-url]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-link-url")).toBe("javascript:window.evil=true");

    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalled();
    expect(openSpy.mock.calls[0][2]).toBe("noopener");
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    editor.destroy();
    openSpy.mockRestore();
  });
});
