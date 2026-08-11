import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import type { EditorAPI } from "@floatboat/nexus-core";
import { Editor } from "@floatboat/nexus-react";

describe("FP-07-02-N04: React <Editor /> 组件渲染并回调 onReady", () => {
  it("步骤1-3: 挂载、onReady、卸载清理", () => {
    let ready: EditorAPI | null = null;
    const { container, unmount } = render(
      <Editor
        initialValue="# Hello"
        onReady={(editor) => {
          ready = editor;
        }}
      />
    );

    // 步骤1: [DOM] .cm-editor 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: [API] onReady 收到可用 EditorAPI
    expect(ready).not.toBeNull();
    expect(ready?.getDocument()).toBe("# Hello");
    // 步骤3: [DOM] unmount 后移除
    unmount();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
