import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-N04: parseDelayMs 配置 IO 解析防抖：窗口内合并、窗口后触发一次", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("步骤1-4: 窗口内不回调、重置计时、窗口后触发一次", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const onChange = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      parseDelayMs: 100,
      onChange,
    });

    // 步骤1: [EVENT] setDocument("# A") 防抖窗口内不触发 onChange
    editor.setDocument("# A");
    expect(onChange.mock.calls.length).toBe(0);
    // 步骤2: [EVENT] t=50 再次编辑重置计时，onChange 仍未触发
    vi.advanceTimersByTime(50);
    editor.setDocument("# B");
    expect(onChange.mock.calls.length).toBe(0);
    // 步骤3: [EVENT] 窗口结束后触发 1 次，末次载荷 doc === "# B"
    vi.advanceTimersByTime(100);
    expect(onChange.mock.calls.length).toBe(1);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(last[0]).toBe("# B");
    // 步骤4: [STATE] 恢复真实计时器
    expect(() => vi.useRealTimers()).not.toThrow();

    editor.destroy();
  });
});
