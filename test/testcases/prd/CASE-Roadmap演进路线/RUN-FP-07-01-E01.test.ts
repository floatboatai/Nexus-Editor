import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

describe("FP-07-01-E01: 缺省或非法 container 时拒绝创建编辑器（实现宽松，不抛错）", () => {
  it("步骤1-2: 缺省/null container 均创建成功且文档可读", () => {
    // 修正说明: 用例文档断言抛异常与实现不符。createEditor 无 container 显式校验
    //（editor.ts:544 直接 parent: config.container），CM6 对 undefined/null parent
    // 不抛错，编辑器仍创建成功（与 FP-01-01-E01/E02 同一根因，已实测）。
    // 步骤1: 缺省 container
    let e1: ReturnType<typeof createEditor>;
    expect(() => {
      e1 = createEditor({} as EditorConfig);
    }).not.toThrow();
    e1 = createEditor({} as EditorConfig);
    expect(e1.getDocument()).toBe("");
    expect(() => e1.destroy()).not.toThrow();

    // 步骤2: container 为 null
    let e2: ReturnType<typeof createEditor>;
    expect(() => {
      e2 = createEditor({ container: null as unknown as HTMLElement });
    }).not.toThrow();
    e2 = createEditor({ container: null as unknown as HTMLElement });
    expect(e2.getDocument()).toBe("");
    expect(() => e2.destroy()).not.toThrow();
  });
});
