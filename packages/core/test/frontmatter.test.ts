/**
 * 时间：2026-07-02
 * 功能描述：YAML Frontmatter 面板插件的单元测试套件
 * 版本：v1.0.0
 * 注意事项：测试涵盖 AST 解析、Live Preview 状态下光标进入/离开的折叠切换以及编辑按钮交互。
 * 业务需求背景：为了确保 Obsidian 风格的 Frontmatter 可视化表单组件能够稳定且正确地渲染，避免更新迭代时发生功能回退，编写此测试。
 */

import { describe, expect, it } from "vitest";
import { createEditor } from "../src/index";

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("YAML Frontmatter 插件测试", () => {
  it("应正确解析头部的 YAML Frontmatter 并生成 AST 中的 yaml 节点", () => {
    const container = makeContainer();
    const md = [
      "---",
      "title: \"测试文档\"",
      "tags: [前端, 测试, yaml]",
      "author: Antigravity",
      "---",
      "",
      "正文内容",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    const ast = editor.getAst();
    expect(ast.children[0]).not.toBeUndefined();
    expect(ast.children[0].type).toBe("yaml");

    const yamlNode = ast.children[0] as any;
    expect(yamlNode.value).toContain("title: \"测试文档\"");
    expect(yamlNode.value).toContain("author: Antigravity");

    // 验证后续的正文块被正确解析，且没有被 frontmatter 的闭合横线污染为 HorizontalRule
    expect(ast.children[1]).not.toBeUndefined();
    expect(ast.children[1].type).toBe("paragraph");

    editor.destroy();
    container.remove();
  });

  it("光标在外部时应折叠 Frontmatter 并渲染可视化卡片，光标进入时应展开为源码", () => {
    const container = makeContainer();
    const md = [
      "---",
      "title: \"可视化测试\"",
      "tags: [test]",
      "---",
      "",
      "正文在此",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // 1. 光标在正文末尾（Frontmatter 范围外）
    editor.setSelection(editor.getDocument().length);
    
    // 应该渲染出 nexus-frontmatter-panel 可视化属性面板
    const panel = container.querySelector(".nexus-frontmatter-panel") as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("title");
    expect(panel?.textContent).toContain("可视化测试");

    // 原始 YAML 源码文本不应该出现在可视区域（已被 Widget 折叠替换）
    expect(container.textContent).not.toContain("title: \"可视化测试\"");

    // 2. 将光标移入 Frontmatter 内部（偏移量为 5）
    editor.setSelection(5);

    // 面板 Widget 应该自动销毁消失，展现源码文本
    const panelInside = container.querySelector(".nexus-frontmatter-panel");
    expect(panelInside).toBeNull();
    expect(container.textContent).toContain("title: \"可视化测试\"");

    editor.destroy();
    container.remove();
  });

  it("点击属性面板的编辑按钮时，应自动跳转将光标定位到 Frontmatter 首行并展开源码", () => {
    const container = makeContainer();
    const md = [
      "---",
      "title: \"跳转测试\"",
      "---",
      "",
      "正文内容",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // 光标初始化在末尾，折叠状态
    editor.setSelection(editor.getDocument().length);

    const editBtn = container.querySelector(".nexus-frontmatter-panel button") as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();

    // 模拟点击编辑按钮
    editBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // 校验光标是否已被移动至第 0 位（Frontmatter 首部）
    const selection = editor.getSelection();
    expect(selection.anchor).toBe(0);

    // 校验属性面板是否已因光标进入而展开消失
    const panel = container.querySelector(".nexus-frontmatter-panel");
    expect(panel).toBeNull();

    editor.destroy();
    container.remove();
  });

  /**
   * 时间：2026-07-02
   * 功能描述：校验非法的 YAML 格式在折叠模式下能否正确显示高警示红色警告卡片面板
   * 注意事项：错误需要精确指示行号和具体异常原因。
   * 业务需求背景：验证 YAML 属性诊断机制的交互健壮性，确保用户能够在预览卡片上即时感知元数据解析故障。
   */
  it("对于非法的 YAML 格式，应能正确捕获语法解析异常并提供精确行号与错误信息面板", () => {
    const container = makeContainer();
    const md = [
      "---",
      "title:错误格式",
      "---",
      "",
      "正文内容",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // 光标移入正文以折叠卡片
    editor.setSelection(editor.getDocument().length);
    
    const panel = container.querySelector(".nexus-frontmatter-panel") as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("YAML 格式解析失败");
    expect(panel?.textContent).toContain("第 1 行");
    expect(panel?.textContent).toContain("冒号 ':' 与后面的值之间必须保留至少一个空格间隔");

    editor.destroy();
    container.remove();
  });

  /**
   * 时间：2026-07-02
   * 功能描述：校验源码编辑状态下（光标在内部时），非法的 YAML 行是否应用了红色波浪线下划线装饰器
   * 注意事项：通过查询 DOM 中是否含有符合波浪线样式的属性节点来进行断言。
   * 业务需求背景：验证行级语法错误高亮提示（Inline Diagnostics）是否已与 CodeMirror 的渲染管线正确打通。
   */
  it("源码编辑模式下（光标在内部时），若有语法异常，应在对应行应用红色波浪线高亮装饰器", () => {
    const container = makeContainer();
    const md = [
      "---",
      "title:错误格式",
      "---",
      "",
      "正文内容",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // 光标进入 YAML 块内部以展开源码
    editor.setSelection(5);

    // 查询带有波浪线下划线标记的行内高亮元素
    const errorSpans = Array.from(container.querySelectorAll("span")).filter(el => {
      return el.style.textDecoration.includes("underline wavy") || el.style.cssText.includes("underline wavy");
    });
    expect(errorSpans.length).toBeGreaterThan(0);
    expect(errorSpans[0].getAttribute("title")).toContain("冒号 ':' 与后面的值之间必须保留至少一个空格");

    editor.destroy();
    container.remove();
  });

  /**
   * 时间：2026-07-02
   * 功能描述：校验 YAML 自动补全源函数在不同区间下的激活和过滤表现
   * 注意事项：直接在测试中对 yamlCompletionSource 进行模拟调用。
   * 业务需求背景：验证补全源在 YAML 物理区内能正确生成属性键建议，而在正文区无开销跳过。
   */
  it("YAML 补全源应在 Frontmatter 范围内激活联想属性键，并在正文区自动跳过", () => {
    const container = makeContainer();
    const md = [
      "---",
      "t", // 准备在第 2 行输入 t 以补全
      "---",
      "",
      "正文内容",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    const view = (editor as any).view;
    expect(view).not.toBeUndefined();

    // 解析出 languageData 挂载的补全源句柄
    const state = view.state;
    const languageData = state.languageDataAt("autocomplete", 5); // 5 处于 YAML 区间内
    expect(languageData.length).toBeGreaterThan(0);
    const handler = languageData[0];
    expect(handler).not.toBeUndefined();

    // 1. 光标在 YAML 物理区间内（例如偏移为 5），触发补全
    const contextInside = {
      state,
      pos: 5,
      explicit: true,
    } as any;
    const resultInside = handler(contextInside);
    expect(resultInside).not.toBeNull();
    expect(resultInside.options).not.toBeUndefined();
    
    // 应该包含 title, tags, aliases 等常用元数据属性联想选项
    const labels = resultInside.options.map((o: any) => o.label);
    expect(labels).toContain("title");
    expect(labels).toContain("tags");

    // 2. 光标在 YAML 物理区间外（例如偏移为 20，处于正文区），触发补全
    const contextOutside = {
      state,
      pos: 20,
      explicit: true,
    } as any;
    const resultOutside = handler(contextOutside);
    // 应该直接跳过并返回 null，以保证零开销
    expect(resultOutside).toBeNull();

    editor.destroy();
    container.remove();
  });
});
