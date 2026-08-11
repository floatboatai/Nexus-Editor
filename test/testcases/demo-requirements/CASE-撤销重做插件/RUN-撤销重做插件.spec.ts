/**
 * RUN-撤销重做插件.spec.ts — FP-14 撤销重做插件 24 条用例（Playwright Electron demo e2e）
 *
 * 框架: Playwright (_electron + launchDemo) — Electron demo，非 Chrome 浏览器测试
 * 来源: CASE-撤销重做插件-测试用例.md (FP-14-01 N01-N13+I01 / FP-14-02 N01-N12+I01)
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo } from "../../../e2e/helpers/electron-launcher";
import { getEditorText } from "../../../e2e/helpers/editor";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const launched = await launchDemo();
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  await app.close();
});

// CM6 historyKeymap 对 Mod-y 的平台差异：macOS 上 Mod-y 被 mac:"Mod-Shift-z" 覆盖忽略，
// linux/win 上 Mod-y 仍绑定 redo。按平台分别断言。
const IS_MAC = process.platform === "darwin";

// ---- 辅助函数 ----
// 重置编辑器：reload 获得全新 editor 实例（空 history），
// 避免共享实例时 clearEditor 的删除操作污染下一条用例的 undo 栈。
async function clearEditor(p: Page) {
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForSelector(".cm-content", { timeout: 20000 });
  await pause(p, 600);
  // 兜底：确保文档为空（空文档上 Ctrl+a+Backspace 不产生变化，不会污染新 history）
  await p.click(".cm-content");
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.press("Backspace");
  await pause(p, 150);
}
async function typeInEditor(p: Page, text: string) {
  await p.click(".cm-content");
  await p.keyboard.type(text);
}
const pause = (p: Page, ms: number) => p.waitForTimeout(ms);

test.describe("FP-14-01: history() 撤销栈管理", () => {
  test("FP-14-01-N01 [P0] 单步编辑后撤销→ 恢复到初始内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "hello");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("hello");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("hello");
  });

  test("FP-14-01-N02 [P0] 多步编辑后连续撤销→ 逐步恢复", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "one ");
    await pause(page, 700);
    await typeInEditor(page, "two ");
    await pause(page, 700);
    await typeInEditor(page, "three");
    await pause(page, 700);
    let text = await getEditorText(page);
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).toContain("three");

    // 撤销 "three"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).not.toContain("three");
    expect(text).toContain("two");
    expect(text).toContain("one");

    // 撤销 "two"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).not.toContain("two");
    expect(text).toContain("one");

    // 撤销 "one"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).not.toContain("one");
  });

  test("FP-14-01-N03 [P0] 撤销后重做→ 恢复被撤销的内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "undo redo test");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("undo redo test");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("undo redo test");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("undo redo test");
  });

  test("FP-14-01-N04 [P1] 连续撤销后连续重做→ 依次恢复", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "A");
    await pause(page, 700);
    await typeInEditor(page, "B");
    await pause(page, 700);
    await typeInEditor(page, "C");
    await pause(page, 700);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ControlOrMeta+z");
      await pause(page, 200);
    }
    expect(await getEditorText(page)).not.toContain("A");

    // redo A
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("A");

    // redo B
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    const afterB = await getEditorText(page);
    expect(afterB).toContain("A");
    expect(afterB).toContain("B");

    // redo C
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    const afterC = await getEditorText(page);
    expect(afterC).toContain("A");
    expect(afterC).toContain("B");
    expect(afterC).toContain("C");
  });

  test("FP-14-01-N05 [P1] 删除文本后撤销→ 恢复被删除内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "delete me");
    await pause(page, 400);
    await page.keyboard.press("ControlOrMeta+a");
    await pause(page, 150);
    await page.keyboard.press("Backspace");
    await pause(page, 400);
    expect(await getEditorText(page)).not.toContain("delete me");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("delete me");
  });

  test("FP-14-01-N06 [P1] 跨行编辑后撤销→ 恢复多行内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "line1\n");
    await pause(page, 700);
    await typeInEditor(page, "line2\n");
    await pause(page, 700);
    await typeInEditor(page, "line3");
    await pause(page, 700);
    let text = await getEditorText(page);
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");

    // 撤销 "line3"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).not.toContain("line3");
    expect(text).toContain("line2");
    expect(text).toContain("line1");

    // 撤销 "line2"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).not.toContain("line2");
    expect(text).toContain("line1");
  });

  test("FP-14-01-N07 [P1] 连续快速编辑（合并）后撤销→ 一次撤销整批", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "fast typing");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("fast typing");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("fast typing");
  });

  test("FP-14-01-N08 [P2] 大文本输入后撤销→ 恢复大段内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    const bigText = "Lorem ipsum dolor sit amet ".repeat(10);
    await typeInEditor(page, bigText);
    await pause(page, 500);
    expect(await getEditorText(page)).toContain("Lorem ipsum");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 300);
    const after = await getEditorText(page);
    expect(after).not.toContain("Lorem ipsum dolor sit amet".repeat(2));
  });

  test("FP-14-01-N09 [P2] 输入→ 删除→ 输入后撤销→ 恢复到正确中间态", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "ABC");
    await pause(page, 700);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    await pause(page, 700);
    await page.keyboard.type("X");
    await pause(page, 700);
    // Delete 后光标停在删除位置（A|C），输入 X 得 AXC（CM6 真实语义）
    expect(await getEditorText(page)).toContain("AXC");

    // 撤销输入 "X"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    let text = await getEditorText(page);
    expect(text).toContain("AC");
    expect(text).not.toContain("AXC");

    // 撤销删除 "B"
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    text = await getEditorText(page);
    expect(text).toContain("ABC");
  });

  test("FP-14-01-N10 [P2] 替换选区文本后撤销→ 恢复原始文本", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "original text");
    await pause(page, 700);
    await page.keyboard.press("Home");
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
    await pause(page, 150);
    // 直接用 keyboard.type 覆盖选区（typeInEditor 的 click 会破坏选区）
    await page.keyboard.type("replaced");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("replaced text");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).toContain("original text");
    expect(text).not.toContain("replaced text");
  });

  test("FP-14-01-N11 [P1] 撤销后新编辑→ 清空重做栈", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "first");
    await pause(page, 700);
    await typeInEditor(page, "second");
    await pause(page, 700);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("first");
    expect(await getEditorText(page)).not.toContain("second");

    // 新编辑
    await typeInEditor(page, "new");
    await pause(page, 400);
    // 尝试重做
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).not.toContain("second");
    expect(text).toContain("first");
    expect(text).toContain("new");
  });

  test("FP-14-01-I01 [P1] history() 与 Live Preview 协同编辑后撤销", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "# Title");
    await pause(page, 700);
    await typeInEditor(page, "\nSome content");
    await pause(page, 700);
    let text = await getEditorText(page);
    expect(text).toContain("Title");
    expect(text).toContain("Some content");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 300);
    text = await getEditorText(page);
    expect(text).not.toContain("Some content");
    expect(text).toContain("Title");
  });

  test("FP-14-01-N12 [P0] 撤销栈为空时再撤销→ 无效果（不报错）", async () => {
    await clearEditor(page);
    await pause(page, 800);
    const initialText = await getEditorText(page);

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toBe(initialText);

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ControlOrMeta+z");
      await pause(page, 150);
    }
    expect(await getEditorText(page)).toBe(initialText);
  });

  test("FP-14-01-N13 [P1] 重做栈为空时再重做→ 无效果（不报错）", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "text");
    await pause(page, 400);
    const initialText = await getEditorText(page);
    expect(initialText).toContain("text");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toBe(initialText);
  });
});

test.describe("FP-14-02: historyKeymap 快捷键", () => {
  test("FP-14-02-N01 [P0] Mod-z（ControlOrMeta+z）撤销单步编辑", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "undo test");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("undo test");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("undo test");
  });

  test("FP-14-02-N02 [P0] Mod-Shift-z 重做被撤销的编辑", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "redo test");
    await pause(page, 400);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("redo test");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("redo test");
  });

  test("FP-14-02-N03 [P1] Mod-y（ControlOrMeta+y）在 macOS 上无 redo 绑定（CM6 mac 覆盖）", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "y redo");
    await pause(page, 400);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("y redo");

    // CM6 historyKeymap: {key:"Mod-y", mac:"Mod-Shift-z", run:redo}
    // macOS 上 Mod-y 被 mac 覆盖忽略，Cmd+y 不触发重做；linux/win 上 Control+y 正常触发重做
    await page.keyboard.press("ControlOrMeta+y");
    await pause(page, 300);
    if (IS_MAC) {
      expect(await getEditorText(page)).not.toContain("y redo");
    } else {
      expect(await getEditorText(page)).toContain("y redo");
    }
  });

  test("FP-14-02-N04 [P1] Mod-u（Control+u）撤销选区操作", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "selection undo");
    await pause(page, 700);
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
    await pause(page, 150);
    await typeInEditor(page, "REPLACED");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("REPLACED");

    await page.keyboard.press("Control+u");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).toContain("selection");
  });

  test("FP-14-02-N05 [P1] 连续 Mod-z 多次撤销→ 逐步回退", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "step1");
    await pause(page, 700);
    await typeInEditor(page, " step2");
    await pause(page, 700);
    await typeInEditor(page, " step3");
    await pause(page, 700);
    expect(await getEditorText(page)).toContain("step3");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("step3");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("step2");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("step1");
  });

  test("FP-14-02-N06 [P1] 撤销后 Mod-Shift-z 重做→ 恢复内容", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "A");
    await pause(page, 700);
    await typeInEditor(page, "B");
    await pause(page, 700);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("A");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("A");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).toContain("A");
    expect(text).toContain("B");
  });

  test("FP-14-02-N07 [P1] Mod-z 与 Mod-Shift-z 交替使用→ 正确切换", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "interleave");
    await pause(page, 400);

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("interleave");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("interleave");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("interleave");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("interleave");
  });

  test("FP-14-02-N08 [P2] 选区状态下按 Mod-z→ 撤销并调整选区", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "selected text");
    await pause(page, 700);
    await page.keyboard.press("ControlOrMeta+a");
    await pause(page, 150);
    // 直接用 keyboard.type 覆盖全选内容（typeInEditor 的 click 会破坏选区）
    await page.keyboard.type("REPLACED");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("REPLACED");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).toContain("selected text");
    expect(text).not.toContain("REPLACED");
  });

  test("FP-14-02-N09 [P2] 空编辑器按 Mod-z→ 无效果不报错", async () => {
    await clearEditor(page);
    await pause(page, 800);
    const initialText = await getEditorText(page);

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toBe(initialText);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toBe(initialText);
  });

  test("FP-14-02-N10 [P2] Mod-Shift-z 重做栈为空时按→ 无效果", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "content");
    await pause(page, 400);
    const initialText = await getEditorText(page);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toBe(initialText);
  });

  test("FP-14-02-N11 [P2] Mod-Shift-z 连续重做两步→ 一致行为", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "A");
    await pause(page, 700);
    await typeInEditor(page, "B");
    await pause(page, 700);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("A");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("A");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    const text = await getEditorText(page);
    expect(text).toContain("A");
    expect(text).toContain("B");
  });

  test("FP-14-02-I01 [P1] 快捷键与其他插件不冲突", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "conflict test");
    await pause(page, 400);
    expect(await getEditorText(page)).toContain("conflict test");

    await page.keyboard.press("ControlOrMeta+z");
    await pause(page, 200);
    expect(await getEditorText(page)).not.toContain("conflict test");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await pause(page, 200);
    expect(await getEditorText(page)).toContain("conflict test");
  });

  test("FP-14-02-N12 [P2] 快速连续按 Mod-z 和 Mod-Shift-z→ 状态一致", async () => {
    await clearEditor(page);
    await pause(page, 700);
    await typeInEditor(page, "rapid test");
    await pause(page, 400);

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(100);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.waitForTimeout(100);
    }
    expect(await getEditorText(page)).toContain("rapid test");
  });
});
