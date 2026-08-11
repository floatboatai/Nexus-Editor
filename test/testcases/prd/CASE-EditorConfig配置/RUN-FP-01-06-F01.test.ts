import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-F01: 多次 focus/blur 交替时回调按序触发", () => {
  it("步骤1-2: events 按序、destroy", () => {
    const events: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onFocus: () => events.push("focus"),
      onBlur: () => events.push("blur"),
    });

    // 步骤1: focus→blur→focus→blur
    editor.focus();
    editor.blur();
    editor.focus();
    editor.blur();
    expect(events).toEqual(["focus", "blur", "focus", "blur"]);
    // 步骤2: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
