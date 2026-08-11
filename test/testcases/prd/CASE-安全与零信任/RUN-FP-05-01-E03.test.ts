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
    initialValue:
      "Intro\n\n<ScRiPt>window.evil=true;</ScRiPt><IMG SRC=x ONERROR=evil()>ok\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-E03: 大小写混淆的 script/img 变体仍被强制清洗", () => {
  it("步骤1-5: ScRiPt 移除、ONERROR 剥离、文本保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.querySelector("script")).toBeNull();
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.textContent).toContain("ok");
    expect(container.textContent).not.toContain("window.evil=true");
    editor.destroy();
  });
});
