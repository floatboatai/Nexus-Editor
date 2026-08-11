import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { useEditor } from "@floatboat/nexus-react";

describe("FP-07-02-N05: React useEditor hook 暴露命令式 EditorAPI", () => {
  it("步骤1-2: editor 在 effect 可用，setDocument 生效", () => {
    const snapshots: string[] = [];
    function Harness() {
      const { containerRef, editor } = useEditor({ initialValue: "start" });
      useEffect(() => {
        if (!editor) return;
        editor.setDocument("updated");
        snapshots.push(editor.getDocument());
      }, [editor]);
      return <div ref={containerRef} />;
    }
    render(<Harness />);

    // 步骤1: [STATE] editor 在 effect 中可用
    expect(snapshots.length).toBeGreaterThan(0);
    // 步骤2: [API] 命令式 API 生效
    expect(snapshots).toContain("updated");
  });
});
