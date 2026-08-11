import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { Editor } from "@floatboat/nexus-react";

describe("FP-07-02-E01: React 组件缺省 onReady/受控 value 时正常渲染（非受控模式）", () => {
  it("步骤1-3: 渲染不抛错、挂载且文档生效、卸载不抛错", () => {
    const { container, unmount } = render(<Editor initialValue="hello" />);

    // 步骤1: [STATE] 渲染不抛异常（已执行到此处即通过）
    // 步骤2: [DOM] .cm-editor 存在，.cm-content 包含 "hello"
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("hello");
    // 步骤3: [STATE] 卸载不抛异常
    expect(() => unmount()).not.toThrow();
  });
});
