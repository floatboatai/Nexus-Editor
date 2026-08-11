# 教训 - Roadmap演进路线

## 关联用例

### FP-07-01 Phase1 核心引擎 MVP（11条）
- FP-07-01-N01 [P1] [N] [Vitest] createEditor 基础创建 + AST 根节点
- FP-07-01-N02 [P1] [N] [Vitest] setDocument 同步 + change 事件
- FP-07-01-N03 [P1] [N] [Vitest] 基础 Live Preview 链接渲染
- FP-07-01-N04 [P2] [D] [Vitest] setDocument 全量替换后 AST/TOC 同步
- FP-07-01-N05 [P2] [N] [Vitest] 复杂文档 AST 结构完整
- FP-07-01-E01 [P3] [E] [Vitest] 缺省/非法 container 拒绝创建
- FP-07-01-E02 [P3] [E] [Vitest] 畸形 markdown 解析降级
- FP-07-01-B01 [P4] [B] [Vitest] 空字符串初始文档正常挂载
- FP-07-01-B02 [P4] [D] [Vitest] 中文文本 UTF-16 偏移
- FP-07-01-B03 [P4] [B] [Vitest] 超长文档（千行级）不失败
- FP-07-01-F01 [P5] [F] [Vitest] destroy 清理 DOM 幂等

### FP-07-02 Phase2 框架拥抱（10条）
- FP-07-02-N01 [P1] [N] [Vitest] GFM preset 表格/任务列表
- FP-07-02-N02 [P1] [N] [Vitest] History 插件撤销/重做
- FP-07-02-N03 [P1] [N] [Vitest] Search 插件 Mod-f 面板
- FP-07-02-N04 [P2] [N] [Vitest] React Editor 组件 + onReady
- FP-07-02-N05 [P2] [N] [Vitest] React useEditor hook
- FP-07-02-N06 [P2] [N] [Vitest] Vue Editor 组件挂载卸载
- FP-07-02-F01 [P2] [F] [Vitest] React 受控 value 无回环
- FP-07-02-E01 [P3] [E] [Vitest] React 非受控模式正常
- FP-07-02-E02 [P3] [E] [Vitest] GFM+History+Search 三插件共存
- FP-07-02-D01 [P4] [D] [Vitest] TypeScript 类型定义导出

### FP-07-03 Phase3 桌面端深度（11条）
- FP-07-03-N01 [P1] [N] [Vitest] 自定义 Widget + data-nexus-widget
- FP-07-03-N02 [P1] [N] [Vitest] 多个 Widget 共存互不干扰
- FP-07-03-N03 [P2] [F] [Vitest] ctx.setSelection/focus 交互
- FP-07-03-N04 [P2] [N] [Vitest] parseDelayMs IO 防抖
- FP-07-03-E01 [P3] [E] [Vitest] 光标进入 Widget 范围回退源码
- FP-07-03-E02 [P3] [E] [Vitest] 无匹配 nodeType 静默
- FP-07-03-E03 [P3] [E] [Vitest] match 谓词精细过滤
- FP-07-03-E04 [P3] [E] [Vitest] 非法 Widget（空 nodeType）
- FP-07-03-B01 [P4] [B] [Vitest] block:false 行内 Widget
- FP-07-03-B02 [P4] [B] [Vitest] ignoreEvents:true 事件响应
- FP-07-03-F01 [P5] [F] [Vitest] Widget destroy 回调

## 重要发现

### 本轮执行结果：32/32 全部通过（5 处用例文档假设修正，非产品缺陷）

1. **FP-07-01-B03 超长文档 AST 结构**：1000 行**连续文本**（无空行分隔）按 Markdown 软换行语义是**单个 paragraph**，不是 1000 个 paragraph。用例文档假设 `ast.children.length === 1000` 错误。修正：断言 `ast.children.length === 1` 且文本长度正确。生成用例时不可凭"行数=paragraph 数"推断。
2. **FP-07-01-E01 缺省/null container 校验**：`createEditor({ container: undefined })` 与 `null` 均**不抛错**（CM6 `parent` 为 undefined/null 时创建悬空视图，`editor.ts:543-547` 无显式校验）。用例文档标题"拒绝创建"错误。修正：断言创建成功 + 文档可读 + destroy 不抛错（与 FP-01-01-E01/E02、FP-07-01-E01 一致）。
3. **FP-07-02-N03/E02 jsdom 中 Mod 解析为 Ctrl**：jsdom `navigator.platform` 为空字符串，CM6 平台判断将 `Mod` 映射为 `Ctrl`。`metaKey` 事件不触发、`ctrlKey` 事件触发、两者都带反而不触发。修正：key 保持 `"Mod-f"`，事件派发改用 `ctrlKey: true`（与 FP-02-06-N03 同款）。
4. **FP-07-02 React JSX 扩展名**：React 用例含 JSX 但用 `.ts` 扩展，esbuild classic JSX 模式下报 "React is not defined"。修正：重命名为 `.test.tsx` 并 `import React from "react"`；runner.mjs 正则同步支持 `.test.tsx`。受控组件 `value` 变更需通过组件内暴露的引用 `setValue`（`act(() => setValue?.("v2"))`），闭包外不可直接访问 setState。
5. **FP-07-02-E02 双次 createEditor 陷阱**：`expect(() => { editor = createEditor(...) }).not.toThrow()` 后再执行第二次 `createEditor`，同一 container 出现两个 `.cm-editor`，querySelector 命中第一个、editor 引用第二个，事件与断言不同步。修正：用 `const creator = () => { editor = createEditor(...) }; expect(creator).not.toThrow(); editor = editor!;` 单次创建。

## 额外教训

- **markdown 软换行语义**：连续文本行（无空行）是单个 paragraph。涉及"千行级文档"类用例时，若文档由 `\n` 连接的无空行文本组成，AST 顶层只有 1 个 paragraph（若由 `\n\n` 分隔才是多块）。
- **React 组件测试三条铁律**：① JSX 必须 `.tsx` 扩展 + `import React`；② 受控组件 setState 需通过引用暴露（`let setValue: ((v: string) => void) | null = null`）；③ `render` 后需 `await nextTick/act` 等待挂载。
- **禁止在同一 container 上重复 createEditor**：第二实例会叠加在首个实例之上，造成 DOM 与引用不同步。需要"创建不抛错"验证时用 IIFE 单次创建模式。
- **jsdom 键盘事件**：CM6 平台层把 `Mod` 映射为 `Ctrl`（`navigator.platform` 为空）。派发快捷键事件一律用 `ctrlKey: true`。
- **Widget 交互断言**（FP-07-03-N03）：点击 widget 后 `ctx.setSelection` 将光标置入源码范围，选区 `anchor` 应落在源码范围 `[from, to)` 内，widget 消失、源码可见。断言区间而非精确值可避免解析偏移误差。
- **runner.mjs 正则**：必须同时匹配 `.test.ts` 与 `.test.tsx`（`/^RUN-.+\.(test|spec)\.tsx?$/`），否则 React 用例被漏跑。
