import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const alertSpy = vi.fn();
  vi.stubGlobal("alert", alertSpy);
  const editor = createEditor({
    container,
    initialValue:
      'Intro\n\n<img src=x onerror=alert(1)><script>alert(2)</script>' +
      '<a href="javascript:alert(3)">x</a>\n\nend',
    livePreview: true,
  });
  return { container, editor, alertSpy };
}

describe("FP-05-01-E04: 复合 XSS 载荷全部中和", () => {
  it("步骤1-5: onerror 剥离、script 移除、href 中和、alert 未调用", () => {
    const { container, editor, alertSpy } = setup();
    editor.setSelection(editor.getDocument().length);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.hasAttribute("onerror")).toBe(false);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("#");
    expect(alertSpy).not.toHaveBeenCalled();
    editor.destroy();
    vi.unstubAllGlobals();
  });
});
