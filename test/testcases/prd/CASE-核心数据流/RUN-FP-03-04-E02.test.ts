import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn();
  const onEvent = vi.fn();
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange,
  });
  editor.on("change", onEvent);
  return { onChange, onEvent, editor };
}

describe("FP-03-04-E02: on('change') 事件与 onChange 回调同时触发且参数一致", () => {
  it("步骤1-4: 双通道同步触发、参数一致、silent 双静默", () => {
    const { onChange, onEvent, editor } = setup();
    editor.setDocument("hello");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);

    expect(onEvent.mock.calls[0][0]).toBe("hello");
    expect((onEvent.mock.calls[0][1] as { type: string }).type).toBe("root");

    expect(onChange.mock.calls[0][0]).toBe(onEvent.mock.calls[0][0]);
    expect(onChange.mock.calls[0][1]).toBe(onEvent.mock.calls[0][1]);

    editor.setDocument("x", { silent: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});
