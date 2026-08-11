# e2e 补充测试用例 — prd（Playwright / Electron Demo）

> 输入源: test/function_points/FP-prd-功能点.md（prd.md v1.0 功能点）
> 生成时间: 2026-08-11
> 执行模式: 定向 e2e 生成（基础 + 源码增强一步完成）
> 生成依据: fp2tc 技能「测试框架判定规则」— 含 [数据IO] 标签的功能点强制 Playwright；无 [数据IO] 但可在 Electron demo 端到端验证的交互类功能点作为规则外 e2e 增强

## 覆盖范围

| 一级功能点 | 二级功能点 | 用例数 | 类型标签 | e2e 判定 |
|-----------|-----------|--------|---------|---------|
| FP-01 EditorConfig配置 | FP-01-07 onAssetUpload | 8 | [API契约][数据IO] | ✅ 规则内强制 Playwright |
| FP-01 EditorConfig配置 | FP-01-05 onChange | 3 | [API契约] | ⚠️ 规则外增强 |
| FP-01 EditorConfig配置 | FP-01-06 onFocus/onBlur | 3 | [API契约] | ⚠️ 规则外增强 |
| FP-03 核心数据流 | FP-03-01 用户输入→EditorState | 4 | [编辑交互] | ⚠️ 规则外增强 |
| FP-04 LivePreview | FP-04-01/02 折叠/展开 | 6 | [Live Preview] | ⚠️ 规则外增强 |
| FP-06 模块化UI委托 | FP-06-02 slashMenuChange 订阅 | 4 | [编辑交互][API契约] | ⚠️ 规则外增强 |

## e2e 全局前置条件

- 依赖环境: Electron demo（Vite dev server localhost:5173 + 已构建的 `apps/electron-demo/dist-electron/main.js`）
- 初始文档: demo 启动后默认打开的 sample-vault 文档（或 index.md）
- 插件配置: demo 默认挂载 —— createGfmPreset + createHistoryPlugin + createToolbarPlugin + createSearchPlugin + createWikilinksPlugin + createWordCountPlugin
- setup 代码:
  ```typescript
  import { _electron as electron, test, expect, type ElectronApplication, type Page } from "@playwright/test";
  import { launchDemo } from "../helpers/electron-launcher";

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

  // 输入辅助（复用 test/e2e/editor.spec.ts 既有模式）
  async function typeInEditor(page: Page, text: string) {
    await page.click(".cm-content");
    await page.evaluate((t) => document.execCommand("insertText", false, t), text);
  }

  async function pressEnter(page: Page) {
    await page.keyboard.press("Enter");
  }

  // 模拟文件拖拽到编辑器（构造 DataTransfer，不依赖真实文件系统）
  async function dropFiles(page: Page, fileNames: string[], kinds: string[] = ["image/png"]) {
    await page.evaluate(
      ({ names, kds }) => {
        const dt = new DataTransfer();
        names.forEach((name, i) => {
          const file = new File([new Uint8Array([1, 2, 3])], name, { type: kds[i] });
          dt.items.add(file);
        });
        const target = document.querySelector(".cm-content");
        const dropEvent = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        target?.dispatchEvent(dropEvent);
      },
      { names: fileNames, kds: kinds }
    );
  }
  ```

---

# FP-01-07 onAssetUpload 文件拖拽上传钩子（8 例，[API契约][数据IO]）

## FP-01-07-N01 [P1] [正常] 拖拽图片文件→ onAssetUpload 回调→ 插入图片 markdown

**测试框架**: Playwright

**前置条件**（⚠️ 4要素）:
- 依赖环境: Electron demo
- 初始文档: 空行文档（确保 `.cm-content` 可用）
- 插件配置: 无额外要求（demo 默认插件）
- setup 代码:
  ```typescript
  // step 1: 全局 setup（见 e2e 全局前置条件 launchDemo）
  // step 2: 前置 —— demo 的 editor-shell.ts 需配置 onAssetUpload 测试钩子：
  //   onAssetUpload: async (file) => {
  //     (window as any).__uploadCalls = (window as any).__uploadCalls ?? [];
  //     (window as any).__uploadCalls.push(file.name);
  //     return `/assets/${file.name}`;
  //   }
  // step 3: 清空编辑区
  await page.evaluate(() => { (window as any).__uploadCalls = []; });
  // step 4: 构造文件拖拽事件
  await dropFiles(page, ["photo.png"], ["image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 `.cm-content` 上派发含 photo.png 的 drop 事件 | [EVENT] `__uploadCalls` 含 `["photo.png"]`（onAssetUpload 被调用） | import: ../helpers/electron-launcher; API: dropFiles(photo.png); 框架: playwright; 等待: __uploadCalls 非空 |
| 2 | 等待 300ms 断言文档内容 | [DOM] `.cm-content` 文本包含 `![](/assets/photo.png)` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [EVENT] `window.__uploadCalls` 记录了被上传的文件名
- [DOM] 上传返回的相对 URL 被以 `![](url)` 形式插入文档

## FP-01-07-N02 [P1] [正常] 粘贴图片文件（clipboardData）→ 走上传管线

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo（见全局 setup）
  // step 2: demo 需配置 onAssetUpload 钩子（同 FP-01-07-N01）
  await page.evaluate(() => { (window as any).__uploadCalls = []; });
  // step 3: 构造 paste 事件，clipboardData 携带图片文件
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], "clip.png", { type: "image/png" }));
    const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
    document.querySelector(".cm-content")?.dispatchEvent(pasteEvent);
  });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 派发携带 clip.png 的 paste 事件 | [EVENT] `__uploadCalls` 含 `["clip.png"]` | import: ../helpers/electron-launcher; API: page.evaluate(dispatch paste); 框架: playwright; 等待: __uploadCalls 非空 |
| 2 | 断言粘贴路径也触发上传 | [DOM] 文档包含 `![](/assets/clip.png)` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [EVENT] paste 路径同样触发 onAssetUpload
- [DOM] 粘贴上传的 URL 已插入文档

## FP-01-07-N03 [P3] [正常] 回调返回 null → 放弃插入，不产生坏链接

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: `"# start"` 且记录初始内容
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 需配置 onAssetUpload: async () => null（表示放弃上传）
  // step 3: 记录初始文档
  const before = await page.locator(".cm-content").textContent();
  // step 4: 派发拖拽
  await dropFiles(page, ["reject.png"], ["image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 拖拽 reject.png 到编辑器 | [EVENT] 无插入、无异常 | import: ../helpers/electron-launcher; API: dropFiles(reject.png); 框架: playwright; 等待: 300ms |
| 2 | 断言文档与 before 完全一致 | [DOM] `.cm-content` 文本不变（无坏链接 `![](null)`） | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 文档内容未被修改
- [DOM] 未插入 `![](null)` / 空链接

## FP-01-07-N04 [P2] [正常] 回调返回远程 URL → 插入完整图片语法

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 需配置 onAssetUpload: async () => "https://cdn.example.com/pic.png"
  // step 3: 派发拖拽
  await dropFiles(page, ["remote.png"], ["image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 拖拽 remote.png | [EVENT] 回调返回远程 URL | import: ../helpers/electron-launcher; API: dropFiles(remote.png); 框架: playwright; 等待: 300ms |
| 2 | 断言文档 | [DOM] 包含 `![](https://cdn.example.com/pic.png)` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 远程 URL 原样插入文档

## FP-01-07-E01 [P3] [异常] 回调抛异常 → 编辑器不崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 需配置 onAssetUpload: async () => { throw new Error("boom"); }
  // step 3: 派发拖拽
  await dropFiles(page, ["crash.png"], ["image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 拖拽 crash.png | [DOM] 无 unhandled error，编辑器仍可见 | import: ../helpers/electron-launcher; API: dropFiles(crash.png); 框架: playwright; 等待: 无 |
| 2 | 继续输入文本验证编辑器存活 | [DOM] `.cm-editor` 可见且可输入 | import: ../helpers/electron-launcher; API: typeInEditor("alive"); 框架: playwright; 等待: .cm-content 含 alive |

**断言汇总**:
- [DOM] 异常后编辑器实例未销毁，可继续编辑

## FP-01-07-E02 [P2] [异常] 拖拽纯文本文件 → 不走上传管线，文本正常插入

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 需配置 onAssetUpload 钩子（记录调用）
  await page.evaluate(() => { (window as any).__uploadCalls = []; });
  // step 3: 构造 text/plain 文件拖拽
  await dropFiles(page, ["note.txt"], ["text/plain"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 拖拽 note.txt（text/plain） | [EVENT] 按实现 `collectFilesFromDataTransfer` 判定，非图片类文件仍走上传管线（当前实现不区分 MIME） | import: ../helpers/electron-launcher; API: dropFiles(note.txt); 框架: playwright; 等待: 300ms |
| 2 | 断言编辑器状态 | [DOM] 编辑器无异常、可继续操作（不强制断言插入，标注待确认） | import: ../helpers/electron-launcher; API: typeInEditor("ok"); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 拖拽任意文件均不破坏编辑器

## FP-01-07-B01 [P4] [边界] 多文件同时拖拽 → 逐个上传插入

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: 无额外要求
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 需配置 onAssetUpload: async (file) => `/assets/${file.name}`
  await page.evaluate(() => { (window as any).__uploadCalls = []; });
  // step 3: 一次性拖拽 3 个文件
  await dropFiles(page, ["a.png", "b.png", "c.png"], ["image/png", "image/png", "image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 拖拽 3 个图片文件 | [EVENT] `__uploadCalls` 长度为 3 | import: ../helpers/electron-launcher; API: dropFiles(a,b,c.png); 框架: playwright; 等待: __uploadCalls.length===3 |
| 2 | 断言文档 | [DOM] 文档包含 3 个 `![](...)` 插入（`/assets/a.png`、`/assets/b.png`、`/assets/c.png`） | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [EVENT] 多文件逐个调用回调
- [DOM] 每个文件的 URL 均被插入

## FP-01-07-B02 [P4] [边界] 未配置回调时拖拽 → 无行为破坏（demo 现状降级验证）

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo（当前 demo 未配置 onAssetUpload，本用例即当前可执行现状）
- 初始文档: 空行文档
- 插件配置: 无额外要求（demo 默认）
- setup 代码:
  ```typescript
  // step 1: launchDemo（不注入任何 onAssetUpload 配置）
  // step 2: 派发拖拽
  await dropFiles(page, ["drop.png"], ["image/png"]);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在未配置回调的 demo 上拖拽图片 | [STATE] `editor.ts` 的 drop handler 因 `!config.onAssetUpload` 返回 false，不插入 | import: ../helpers/electron-launcher; API: dropFiles(drop.png); 框架: playwright; 等待: 300ms |
| 2 | 断言无插入且编辑器正常 | [DOM] `.cm-content` 无 `![](...)` 新增，编辑器可用 | import: ../helpers/electron-launcher; API: typeInEditor("ok"); 框架: playwright; 等待: 无 |

**断言汇总**:
- [STATE] 无回调时拖拽文件不产生任何插入
- [DOM] 编辑器保持可用

---

# FP-01-05 onChange 内容变更回调（3 例，[API契约] — 规则外 e2e 增强）

## FP-01-05-N01 [P1] [正常] 输入文本 → onChange 触发 → dirty 状态生效

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: sample-vault 默认文档（demo 启动即加载，初始 dirty=false）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: demo 的 editor-shell.ts 已配置 onChange（更新 state.content + state.dirty=true + linkIndex.updateFile）
  // step 3: 记录编辑前状态
  await page.evaluate(() => { (window as any).__changed = false; });
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 `.cm-content` 输入 `" edit"` | [EVENT] onChange 被触发（editor.ts emitChange 管线），dirty 置 true | import: ../helpers/electron-launcher; API: typeInEditor(" edit"); 框架: playwright; 等待: 300ms |
| 2 | 断言编辑后的可观测副作用 | [DOM] 字数统计状态栏同步更新（wordcount 监听同一 change） | import: ../helpers/electron-launcher; API: page.locator(body).textContent(); 框架: playwright; 等待: 匹配 /\d+ words/ |

**断言汇总**:
- [EVENT] 编辑操作触发 onChange 管线
- [DOM] 依赖 change 事件的 wordcount 状态栏同步刷新（间接证明 onChange 生效）

## FP-01-05-N02 [P2] [正常] 连续输入 → parseDelayMs(150ms) 防抖合并

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认（parseDelayMs: 150）
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 快速连续输入一串字符（模拟打字突刺）
  await typeInEditor(page, "quickburst0123456789");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 快速连续输入 20 字符 | [STATE] 防抖期内不重复全量 mdast 遍历，最终内容一致 | import: ../helpers/electron-launcher; API: typeInEditor(quickburst...); 框架: playwright; 等待: 无 |
| 2 | 等待 300ms 后断言 | [DOM] `.cm-content` 完整包含全部输入字符，无丢失 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [STATE] 防抖不导致内容丢失
- [DOM] 最终渲染与输入一致

## FP-01-05-D01 [P3] [数据] 加载文件（silent）→ 不触发 onChange 管线

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: sample-vault 已打开文件
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 通过 Vault 面板打开另一个文件（走 editor-shell.loadDocument → setDocument silent:true）
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在 Vault 面板点击切换文件 | [STATE] `setDocument(content, { silent: true })` 跳过 onChange 管线（editor-shell.ts:363），state.dirty 由调用方显式置 false | import: ../helpers/electron-launcher; API: page.click(vault 文件项); 框架: playwright; 等待: .cm-content 更新 |
| 2 | 断言加载不产生用户编辑副作用 | [DOM] 切换后不出现脏状态提示/字数统计基于新文档 | import: ../helpers/electron-launcher; API: page.locator(body).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [STATE] silent 加载不进入编辑脏状态
- [DOM] 新文档正常渲染

---

# FP-01-06 onFocus/onBlur 焦点回调（3 例，[API契约] — 规则外 e2e 增强）

## FP-01-06-N01 [P1] [正常] 点击编辑器 → 获得焦点

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 先点击页面空白处确保编辑器失焦
  await page.mouse.click(5, 5);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击 `.cm-content` | [DOM] CM6 焦点类 `.cm-focused` 出现在 `.cm-editor` 上 | import: ../helpers/electron-launcher; API: page.click(.cm-content); 框架: playwright; 等待: .cm-editor.cm-focused |
| 2 | 断言焦点状态 | [STATE] 编辑器 hasFocus 为 true（宿主回调触发标注待确认：demo 未配置 onFocus） | import: ../helpers/electron-launcher; API: page.evaluate(el => el.hasFocus()); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] `.cm-focused` 类生效
- [STATE] 编辑器 DOM 持有焦点

## FP-01-06-N02 [P2] [正常] 点击外部 → 失焦

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 先聚焦编辑器
  await page.click(".cm-content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 点击编辑器外部区域（如工具栏空白处） | [DOM] `.cm-focused` 类被移除 | import: ../helpers/electron-launcher; API: page.mouse.click(远离编辑器坐标); 框架: playwright; 等待: .cm-focused 隐藏 |
| 2 | 断言失焦 | [STATE] 编辑器 hasFocus 为 false（onBlur 回调触发标注待确认） | import: ../helpers/electron-launcher; API: page.evaluate(el => el.hasFocus()); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 失焦后 `.cm-focused` 移除

## FP-01-06-E01 [P3] [异常] 失焦后重新输入 → 恢复聚焦不崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 聚焦→失焦→再聚焦的完整循环
  await page.click(".cm-content");
  await page.mouse.click(5, 5);
  await page.click(".cm-content");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 完成聚焦→失焦→再聚焦循环 | [DOM] 编辑器无异常，`.cm-focused` 恢复 | import: ../helpers/electron-launcher; API: page.click(.cm-content); 框架: playwright; 等待: .cm-focused |
| 2 | 输入文本验证 | [DOM] 输入生效，内容更新 | import: ../helpers/electron-launcher; API: typeInEditor("focus-ok"); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 焦点循环后编辑器正常可用

---

# FP-03-01 核心数据流-用户输入→EditorState（4 例，[编辑交互] — 规则外 e2e 增强）

## FP-03-01-N01 [P1] [正常] 输入文本 → EditorState 更新 → 渲染

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 在编辑器输入数据流标记文本
  await typeInEditor(page, "DATA_FLOW_20260811_001");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入带时间戳的标记文本 | [STATE] CM6 Transaction → EditorState.doc 更新 | import: ../helpers/electron-launcher; API: typeInEditor(...); 框架: playwright; 等待: 无 |
| 2 | 断言渲染 | [DOM] `.cm-content` 包含 `DATA_FLOW_20260811_001` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 输入内容即时渲染（State 单向数据流可观测）

## FP-03-01-N02 [P2] [正常] 输入 Markdown → AST 解析 → Live Preview 生效

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认（livePreview enabled）
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 输入标题语法
  await typeInEditor(page, "# Flow Heading");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `# Flow Heading` 并移出光标 | [DOM] 标题渲染类生效（如 `.cm-heading`），`#` 被折叠 | import: ../helpers/electron-launcher; API: typeInEditor("# Flow Heading"); 框架: playwright; 等待: 300ms |
| 2 | 断言标题可见 | [DOM] 文本 "Flow Heading" 可见且带标题样式 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Markdown 语法经 AST→Decoration 管线渲染为标题

## FP-03-01-E01 [P3] [异常] 极长文本输入 → 不崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 构造 10KB 文本
  const bigText = "x".repeat(10240);
  await typeInEditor(page, bigText);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 一次性输入 10KB 文本 | [DOM] 编辑器不崩溃，无 JS 异常 | import: ../helpers/electron-launcher; API: typeInEditor(10KB); 框架: playwright; 等待: 无 |
| 2 | 断言内容长度 | [DOM] `.cm-content` 包含全部 10240 字符（或按性能容忍截断断言） | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 大文档输入不破坏编辑器状态

## FP-03-01-B01 [P4] [边界] 空文档输入 → 正常

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空文档（无内容）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo（启动后清空内容或直接在空行输入）
  // step 2: 输入单个字符
  await typeInEditor(page, "a");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在空文档输入 1 字符 | [DOM] 正常渲染 | import: ../helpers/electron-launcher; API: typeInEditor("a"); 框架: playwright; 等待: 无 |
| 2 | 断言 | [DOM] `.cm-content` 包含 `a` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 空文档边界输入正常

---

# FP-04-01/02 Live Preview 折叠/展开（6 例，[Live Preview] — 规则外 e2e 增强）

## FP-04-01-N01 [P1] [正常] 输入 `**bold**` → 光标移出 → 折叠渲染粗体

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认（livePreview enabled）
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 输入粗体语法
  await typeInEditor(page, "This is **bold text**");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `**bold text**` 后移出光标 | [DOM] 粗体语法折叠，`**` 隐藏，仅见 "bold text" | import: ../helpers/electron-launcher; API: typeInEditor("This is **bold text**"); 框架: playwright; 等待: 300ms |
| 2 | 断言无裸语法 | [DOM] `.cm-content` 不含字面 `**bold text**`（折叠为 Widget/Mark 装饰） | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 光标不在语法内时 `**` 标记被隐藏

## FP-04-01-N02 [P2] [正常] 光标移入粗体区 → 展开显示源码

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 包含 `**bold text**`（光标已在区外）
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 输入并移出 → 再点击粗体文本中间
  await typeInEditor(page, "**bold text**");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.click(".cm-content");
  // 光标回到语法附近
  await page.keyboard.press("ArrowLeft");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 光标移回粗体语法内部 | [DOM] 源码展开，`**bold text**` 完整可见（含标记） | import: ../helpers/electron-launcher; API: page.keyboard.press(ArrowLeft); 框架: playwright; 等待: 300ms |
| 2 | 断言源码 | [DOM] `.cm-content` 包含 `**` 标记 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 光标感知渲染：进入语法区显示源码

## FP-04-02-N01 [P1] [正常] 输入 `# heading` → 光标移出 → 标题渲染

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await typeInEditor(page, "# My Heading");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入标题语法并移出光标 | [DOM] `.cm-heading` 装饰出现，`#` 隐藏 | import: ../helpers/electron-launcher; API: typeInEditor("# My Heading"); 框架: playwright; 等待: 300ms |
| 2 | 断言标题文本 | [DOM] "My Heading" 可见 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 块级标题折叠渲染

## FP-04-01-N03 [P2] [正常] 输入 `*italic*` → 渲染斜体

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await typeInEditor(page, "This is *italic text*");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入斜体语法并移出光标 | [DOM] `*` 标记隐藏，仅见 "italic text" | import: ../helpers/electron-launcher; API: typeInEditor("This is *italic text*"); 框架: playwright; 等待: 300ms |
| 2 | 断言 | [DOM] `.cm-content` 不含字面 `*italic text*` | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 行内斜体折叠渲染

## FP-04-01-B01 [P4] [边界] 嵌套格式 `***bold italic***` → 组合样式

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await typeInEditor(page, "***bold italic***");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入嵌套格式并移出光标 | [DOM] 三连 `***` 标记折叠，文本 "bold italic" 渲染 | import: ../helpers/electron-launcher; API: typeInEditor("***bold italic***"); 框架: playwright; 等待: 300ms |
| 2 | 断言无裸语法 | [DOM] `.cm-content` 不含 `***bold italic***` 字面 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 嵌套行内格式正确折叠

## FP-04-01-E01 [P3] [异常] 光标快速进出语法标记 → 不崩溃

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 含多种语法：`**b** *i* # h`
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 快速左右移动光标穿过多个语法标记
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
  }
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 快速左右移动光标 10 次 | [DOM] 无异常、无白屏 | import: ../helpers/electron-launcher; API: page.keyboard.press(ArrowLeft/Right); 框架: playwright; 等待: 无 |
| 2 | 断言编辑器存活 | [DOM] `.cm-editor` 可见且可输入 | import: ../helpers/electron-launcher; API: typeInEditor("ok"); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 光标快速穿越语法区不破坏渲染状态

---

# FP-06-02 模块化 UI 委托-slashMenuChange 状态订阅（4 例，[编辑交互][API契约] — 规则外 e2e 增强）

## FP-06-02-N01 [P1] [正常] 输入 `/` → 浮层菜单弹出

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认（plugin-toolbar 注册 14 个斜杠命令）
- setup 代码:
  ```typescript
  // step 1: launchDemo
  // step 2: 新起一行输入 `/`
  await pressEnter(page);
  await pressEnter(page);
  await page.keyboard.press("/");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `/` | [DOM] `.nexus-slash-menu` 可见（含 `role=option` 项） | import: ../helpers/electron-launcher; API: page.keyboard.press(/); 框架: playwright; 等待: .nexus-slash-menu 可见 |
| 2 | 断言菜单内容 | [DOM] 菜单含 "Heading 1" 等命令（来自 plugin-toolbar 注册） | import: ../helpers/electron-launcher; API: page.locator(.nexus-slash-menu).innerText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 斜杠菜单由宿主（demo）根据 slashMenuChange 状态渲染

## FP-06-02-N02 [P2] [正常] 输入 `/h1` → 过滤命令

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await pressEnter(page);
  await pressEnter(page);
  await page.keyboard.press("/");
  await page.keyboard.type("h1");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `/h1` | [DOM] 过滤后菜单聚焦 "Heading 1" 相关项 | import: ../helpers/electron-launcher; API: page.keyboard.type(h1); 框架: playwright; 等待: 300ms |
| 2 | 断言过滤结果 | [DOM] 菜单文本含 "Heading 1"，不含 "Bold"（按 6 级排序结果） | import: ../helpers/electron-launcher; API: page.locator(.nexus-slash-menu).innerText(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] 查询过滤 + 排序生效

## FP-06-02-N03 [P2] [流程] ↑↓ 高亮 → Enter 确认 → 命令执行

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await pressEnter(page);
  await pressEnter(page);
  await page.keyboard.press("/");
  // step 2: 向下移动高亮到 "Heading 1" 并确认
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `/` → ArrowDown → Enter | [DOM] 菜单关闭，`/query` 被删除，命令 run() 执行 | import: ../helpers/electron-launcher; API: page.keyboard.press(ArrowDown/Enter); 框架: playwright; 等待: .nexus-slash-menu 隐藏 |
| 2 | 断言命令副作用 | [DOM] 文档出现标题内容（Heading 命令插入标题） | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 300ms |

**断言汇总**:
- [DOM] 键盘确认后命令真实执行并修改文档

## FP-06-02-E01 [P3] [异常] Escape 关闭菜单

**测试框架**: Playwright

**前置条件**:
- 依赖环境: Electron demo
- 初始文档: 空行文档
- 插件配置: demo 默认
- setup 代码:
  ```typescript
  // step 1: launchDemo
  await pressEnter(page);
  await pressEnter(page);
  await page.keyboard.press("/");
  await page.keyboard.press("Escape");
  ```

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 输入 `/` 后按 Escape | [DOM] 菜单关闭（dismissed 状态，不执行命令） | import: ../helpers/electron-launcher; API: page.keyboard.press(Escape); 框架: playwright; 等待: .nexus-slash-menu 隐藏 |
| 2 | 断言文档未被修改 | [DOM] `/` 及后续无命令插入 | import: ../helpers/electron-launcher; API: page.locator(.cm-content).textContent(); 框架: playwright; 等待: 无 |

**断言汇总**:
- [DOM] Escape 取消命令，文档无副作用

---

## 增强信息来源

- API签名: packages/core/src/editor.ts（paste/drop 事件处理 L674-L702、uploadAsset API L768-L774、onChange 管线 L113）
- 类型定义: packages/core/src/types.ts（EditorConfig L95-L121：onChange/onFocus/onBlur/onAssetUpload 签名）
- Demo 配置: apps/electron-demo/src/renderer/editor-shell.ts（createEditor 配置 L128-L331；loadDocument silent L357-L374）
- e2e 基础: test/e2e/helpers/electron-launcher.ts（launchDemo）、test/e2e/editor.spec.ts（typeInEditor/pressEnter 辅助）
- 陷阱提示:
  1. demo 未配置 onAssetUpload/onFocus/onBlur → 回调触发断言标注"待确认"，需宿主启用测试钩子
  2. 斜杠菜单可能因 dismissed 锁存未打开（editor.spec.ts:158-165 已记录）→ 过滤用例需先输入文字清除锁存
  3. onAssetUpload 的 drop/paste handler 仅在 `config.onAssetUpload` 存在时接管文件事件，否则返回 false 交回 CM6
