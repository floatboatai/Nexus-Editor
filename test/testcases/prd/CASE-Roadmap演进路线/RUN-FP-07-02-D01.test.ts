import { describe, expect, it } from "vitest";
import {
  createEditor,
  type EditorAPI,
  type EditorConfig,
  type WidgetDefinition,
} from "@floatboat/nexus-core";
import type { EditorProps } from "@floatboat/nexus-react";
import type { SearchPluginOptions } from "@floatboat/nexus-plugin-search";

describe("FP-07-02-D01: TypeScript 类型定义导出可用（编译期契约）", () => {
  it("步骤1-4: 类型编译通过且运行时 API 形状正确", () => {
    // 步骤1: [STATE] 以 EditorAPI 类型接收返回值（编译期校验）
    const editor: EditorAPI = createEditor({
      container: document.createElement("div"),
      initialValue: "type check",
    });
    // 步骤2: [STATE] WidgetDefinition 字面量编译通过
    const widget: WidgetDefinition = {
      nodeType: "code",
      render: () => document.createElement("div"),
    };
    expect(widget.nodeType).toBe("code");
    // 步骤3: [STATE] EditorProps / SearchPluginOptions 编译通过
    const props: EditorProps = { initialValue: "x" };
    const searchOptions: SearchPluginOptions = { top: false, caseSensitive: true };
    expect(props.initialValue).toBe("x");
    expect(searchOptions.top).toBe(false);
    // 步骤4: [API] 运行时 getDocument
    expect(editor.getDocument()).toBe("type check");

    editor.destroy();
  });
});
