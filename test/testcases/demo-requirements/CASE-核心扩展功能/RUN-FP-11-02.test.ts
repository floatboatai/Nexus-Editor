/**
 * RUN-FP-11-02.test.ts — FP-11-02 markdownFold 代码块/标题折叠（vitest 单测）
 *
 * 背景：FP-11-02 需求文档共 7 个用例（N01-N05, E01, B01），验证目标是
 * `markdownFoldService()`（packages/core/src/markdown-fold.ts，自 @floatboat/nexus-core 导出）
 * 返回的折叠范围（from/to）正确性。
 *
 * e2e 为何无法触发真实折叠（已调查确认）：
 * 1. demo（apps/electron-demo）只挂载 markdownFoldService()（editor.ts:669），未挂载
 *    foldGutter() 和 foldKeymap —— markdown-fold.ts:85-89 的 markdownFold() 未被 demo
 *    调用，UI 无折叠入口；
 * 2. Electron BrowserWindow 配置 contextIsolation: true, nodeIntegration: false
 *    （apps/electron-demo/electron/main.ts:47-50），preload 只暴露文件/vault 桥，
 *    renderer 页面 evaluate 中无法 require("@codemirror/language") 获取 foldEffect；
 * 3. 无 window.CodeMirrorFold 等全局暴露。
 *
 * 定位：本文件承接 7 个用例的验证目标 —— 构造 EditorState（extensions 含
 * markdownFoldService()），通过 state.facet(foldService) 取 provider，对指定行调用
 * provider 纯逻辑断言返回范围（foldService provider 只依赖 state，不依赖 DOM）。
 *
 * 注：@codemirror/language 为 pnpm 隔离依赖，仅存在于 packages/core/node_modules。
 * 根 vitest.config.ts 的 resolve.alias 已将其指向
 * packages/core/node_modules/@codemirror/language/dist/index.js（与 @codemirror/view /
 * @codemirror/state 同款处理），保证本文件与 markdown-fold.ts 内 import 的
 * foldService 解析到同一模块实例（facet 实例一致性），state.facet(foldService)
 * 才能命中 provider。
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { foldService } from "@codemirror/language";
import { markdownFoldService } from "@floatboat/nexus-core";

/**
 * 对文档第 lineNumber 行调用 foldService provider，返回折叠范围或 null。
 * foldService provider 签名：(state, lineStart, lineEnd) => FoldResult | null，
 * FoldResult 可能含 widget 字段，这里只取 from/to 断言。
 */
function foldRangeFor(doc: string, lineNumber: number) {
  const state = EditorState.create({ doc, extensions: [markdownFoldService()] });
  const line = state.doc.line(lineNumber);
  const result = state
    .facet(foldService)
    .map((p) => p(state, line.from, line.to))
    .find((r) => r !== null);
  return result ? { from: result.from, to: result.to } : null;
}

describe("FP-11-02: markdownFold 代码块/标题折叠（foldService provider 返回范围）", () => {
  it("FP-11-02-N01 [P1] heading 折叠 —— 标题行末到下一同级标题前", () => {
    // doc: "# Title\nLine 1\nLine 2\n# Second"
    // line1 "# Title"（7 字符）from=0 to=7；line2 "Line 1"（6 字符）from=8 to=14；
    // line3 "Line 2"（6 字符）from=15 to=21；line4 "# Second"（8 字符）from=22
    // → foldEnd = line4.from - 1 = 21（2026-08-11 实测）
    // 预期返回 { from: 7, to: 21 }（line1.to 到 line4.from-1）
    expect(foldRangeFor("# Title\nLine 1\nLine 2\n# Second", 1)).toEqual({ from: 7, to: 21 });
  });

  it("FP-11-02-N02 [P1] heading 折叠范围 —— 到下一同级或更高级标题前停止", () => {
    // doc: "## Sub\nContent A\n# Top"
    // line1 "## Sub" level=2 from=0 to=6；line3 "# Top" level=1 <= 2 → foldEnd = 17-1 = 16
    // 预期返回 { from: 6, to: 16 }（仅覆盖 "Content A" 行，H1 level1 <= H2 level2 停止）
    expect(foldRangeFor("## Sub\nContent A\n# Top", 1)).toEqual({ from: 6, to: 16 });
  });

  it("FP-11-02-N03 [P1] fenced code block 折叠 —— 开 fence 行末到闭 fence 行末", () => {
    // doc: "```js\nconsole.log(1)\nconsole.log(2)\n```"
    // line1 "```js"（5 字符）from=0 to=5；line2 "console.log(1)"（14 字符）from=6 to=20；
    // line3 "console.log(2)"（14 字符）from=21 to=35；line4 "```"（3 字符）from=36 to=39
    // → foldEnd = line4.to = 39 = doc.length（2026-08-11 实测）
    // 预期返回 { from: 5, to: 39 }（line1.to 到闭 fence 行末即文档末尾）
    expect(foldRangeFor("```js\nconsole.log(1)\nconsole.log(2)\n```", 1)).toEqual({ from: 5, to: 39 });
  });

  it("FP-11-02-N04 [P2] 标题无后续内容时返回 null（不提供折叠）", () => {
    // doc: "# Lonely Heading" 单行：foldEnd = doc.length = line.to，foldEnd > line.to 不成立
    // 预期返回 null
    expect(foldRangeFor("# Lonely Heading", 1)).toBeNull();
  });

  it("FP-11-02-N05 [P2] 缩进内容折叠 —— 缩进增加的连续行到末行行末", () => {
    // doc: "- item\n  nested line 1\n  nested line 2"
    // line1 "- item" indent=0 from=0 to=6；line2/line3 indent=2 > 0 均被折叠，
    // foldEnd = line3.to = 38
    // 预期返回 { from: 6, to: 38 }（line1.to 到 line3.to）
    expect(foldRangeFor("- item\n  nested line 1\n  nested line 2", 1)).toEqual({ from: 6, to: 38 });
  });

  it("FP-11-02-E01 [P3] 不完整的 fenced code block（无闭 fence）不崩溃、返回 null", () => {
    // doc: "```js\nconsole.log(1)" 无闭 fence：fenced 分支遍历完无闭 fence 不返回，
    // indent 分支也不满足（line2 无缩进）→ 最终返回 null，不抛异常
    expect(foldRangeFor("```js\nconsole.log(1)", 1)).toBeNull();
  });

  it("FP-11-02-B01 [P4] H6（最大级别）标题折叠到文档末尾", () => {
    // doc: "###### Deep\ncontent under h6"
    // line1 "###### Deep"（11 字符）level=6 from=0 to=11；line2 "content under h6"（16 字符）from=12 to=28
    // 无后续标题 → foldEnd = doc.length = 28（2026-08-11 实测）
    // 预期返回 { from: 11, to: 28 }（line1.to 到文档末尾）
    expect(foldRangeFor("###### Deep\ncontent under h6", 1)).toEqual({ from: 11, to: 28 });
  });
});
