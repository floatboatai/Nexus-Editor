import { describe, expect, it } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@floatboat/nexus-react";

describe("FP-07-02-F01: React 受控 value 外部更新同步且无回环", () => {
  it("步骤1-3: 初始 v1、更新 v2、无回环", () => {
    let setValue: ((v: string) => void) | null = null;
    function Harness() {
      const [value, update] = useState("v1");
      setValue = update;
      return <Editor value={value} onChange={(doc) => update(doc)} />;
    }
    const { container } = render(<Harness />);
    const content = () => container.querySelector(".cm-content");

    // 步骤1: [API] 初始受控值 v1
    expect(content()?.textContent).toContain("v1");
    // 步骤2: [STATE] act 更新为 v2（受控模式 silent setDocument 应用）
    act(() => {
      setValue?.("v2");
    });
    expect(content()?.textContent).toContain("v2");
    // 步骤3: [STATE] 无回环：文档保持 v2
    expect(content()?.textContent).toBe("v2");
  });
});
