import type { Page } from "@playwright/test";

/**
 * 获取编辑器未渲染源码文本。
 *
 * 为什么不用 textContent：Live Preview 装饰会改写 DOM 文本（列表标记 `-`/`*` 渲染为 `•`、
 * 引用 `>` 前缀被隐藏、CM6 用 div.cm-line 分行渲染行间无换行文本节点），
 * 跨行 / 含列表、引用标记的断言必须基于 CM6 源码。
 *
 * 三级防御（均为 @codemirror/view 非公开内部属性，升级时必检）：
 *   1. cmTile.view —— @codemirror/view >= 6.41 在 contentDOM 上挂载 cmTile（当前版本实测存在）
 *   2. cmView.view —— 旧版（< 6.41）挂载 cmView，保留以兼容版本回退
 *   3. textContent —— 最后兜底（单行纯文本场景可用）
 */
export async function getEditorText(p: Page): Promise<string> {
  const doc = await p.evaluate(() => {
    const cmContent = document.querySelector(".cm-content") as any;
    const v = cmContent?.cmTile?.view ?? cmContent?.cmView?.view;
    return v?.state?.doc?.toString() ?? null;
  });
  if (doc !== null) return doc;
  return (await p.locator(".cm-content").textContent()) ?? "";
}
