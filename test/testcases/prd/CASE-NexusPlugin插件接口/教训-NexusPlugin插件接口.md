# 教训 - NexusPlugin插件接口

## 关联用例

### FP-02-01 插件注册（6条）
- FP-02-01-N01 [P1] [插件能力] [Vitest] 注册单个命名插件正常创建渲染
- FP-02-01-N02 [P2] [插件能力] [Vitest] 多插件多 name 扩展聚合生效
- FP-02-01-E01 [P3] [插件能力] [Vitest] 缺失 name 运行时不崩溃
- FP-02-01-E02 [P3] [插件能力] [Vitest] 同名插件扩展均生效
- FP-02-01-B01 [P4] [插件能力] [Vitest] 超长 name 不影响创建
- FP-02-01-F01 [P2] [插件能力] [Vitest] 注册→生效→destroy 完整生命周期

### FP-02-02 快捷键（7条）
- FP-02-02-N01 [P1] [编辑交互] [Vitest] runShortcut 精确执行并返回 true
- FP-02-02-N02 [P1] [编辑交互] [Vitest] 键盘事件实际触发快捷键
- FP-02-02-N03 [P2] [编辑交互] [Vitest] run 返回 false 未消费
- FP-02-02-E01 [P3] [编辑交互] [Vitest] 未注册 key 返回 false
- FP-02-02-E02 [P3] [编辑交互] [Vitest] run 回调抛异常向外传播
- FP-02-02-B01 [P4] [编辑交互] [Vitest] 相同 key 先注册者生效
- FP-02-02-F01 [P5] [编辑交互] [Vitest] 快捷键改文档后 onChange 触发

### FP-02-03 斜杠命令（7条）
- FP-02-03-N01 [P1] [插件能力] [Vitest] getSlashCommands 返回注册命令
- FP-02-03-N02 [P1] [编辑交互] [Vitest] 输入 / 触发 slashMenuChange
- FP-02-03-N03 [P2] [编辑交互] [Vitest] 输入 /hea 前缀过滤排序
- FP-02-03-D01 [P2] [数据] [Vitest] 多插件命令按注册顺序聚合
- FP-02-03-E01 [P3] [编辑交互] [Vitest] slashMenuLimit 0 菜单空
- FP-02-03-B01 [P4] [编辑交互] [Vitest] 查询含空白时菜单关闭
- FP-02-03-F01 [P5] [编辑交互] [Vitest] run 钩子修改文档流程

### FP-02-04 remark 转换（6条）
- FP-02-04-N01 [P1] [AST解析] [Vitest] remark 插件修改 getAst() 输出
- FP-02-04-N02 [P2] [API契约] [Vitest] exportHTML 反映转换结果
- FP-02-04-N03 [P2] [AST解析] [Vitest] setDocument 后 AST 仍经 remark
- FP-02-04-E01 [P3] [AST解析] [Vitest] remark 抛异常导致创建失败
- FP-02-04-B01 [P4] [AST解析] [Vitest] 多 remark 插件按序执行
- FP-02-04-D01 [P3] [数据] [Vitest] 仅改 AST 文档源码无损

### FP-02-05 widget（6条）
- FP-02-05-N01 [P1] [Live Preview] [Vitest] 匹配节点渲染为自定义 widget
- FP-02-05-N02 [P1] [Live Preview] [Vitest] 光标进入 widget 范围恢复源码
- FP-02-05-N03 [P2] [Live Preview] [Vitest] match 谓词精确筛选
- FP-02-05-E01 [P3] [Live Preview] [Vitest] widget 移除时调用 destroy
- FP-02-05-B01 [P4] [Live Preview] [Vitest] 无匹配节点不渲染
- FP-02-05-D01 [P3] [数据] [Vitest] render 的 source 与源码一致

### FP-02-06 cmExtensions（6条）
- FP-02-06-N01 [P1] [插件能力] [Vitest] editorAttributes 注入根节点
- FP-02-06-N02 [P1] [插件能力] [Vitest] ViewPlugin 实例化可访问状态
- FP-02-06-N03 [P1] [编辑交互] [Vitest] keymap 绑定生效
- FP-02-06-E01 [P3] [插件能力] [Vitest] 非法 extension 创建失败
- FP-02-06-B01 [P4] [插件能力] [Vitest] 空 cmExtensions 安全注册
- FP-02-06-B02 [P4] [插件能力] [Vitest] 多插件 cmExtensions 合并生效

## 重要发现

### 本轮执行结果：38/38 全部通过（3 处用例文档假设修正，非产品缺陷）

1. **FP-02-03 斜杠触发前置条件（5 条 setup 修正）**：`getSlashMatch`（[slash-state.ts](file:///Users/mac/PycharmProjects/Nexus_Editor/packages/core/src/slash-state.ts#L40-L63)）要求 `/` 位于**行首或前面为空白**才打开菜单（防 URL/路径误触发）。用例文档假设在单词后直接输 `/`（`"start"` + `/`）会打开菜单，实测 `isOpen=false`。修正：初始文档改为 `"start\n"`、`setSelection(6)` 使 `/` 落在行首。B01 也因此获得更纯粹的语义验证（行首 `/` 因含空格而关闭）。
2. **FP-02-05-N01 断言与 render 实现自相矛盾**：用例 render 主动 `el.textContent = source`，但断言 `container.textContent` 不含 `console.log(1)`——widget 内就包含源码文本，断言必败。修正：改为断言 `.cm-line` 行文本中围栏 ` ```js ` 已消失（源码被 widget 替换的真实标志）。debug 实测：`.cm-line` 的 textContent **不含** widget 内部文本。
3. **FP-02-06-N03 jsdom 中 Mod 解析为 Ctrl**：jsdom `navigator.platform` 为空字符串，CM6 的平台判断把 `Mod` 映射为 `Ctrl`。实测：`metaKey` 事件不触发、`ctrlKey` 事件触发、两者都带反而不触发。修正：key 保持 `"Mod-b"`，事件派发改用 `ctrlKey: true`。

## 额外教训

- **CM6 keymap `run(view)` 参数是 EditorView**：从 `cmExtensions` 注入的 `keymap.of([...])` 中 `run` 回调第一个参数是 `EditorView`（需 `view.dispatch`），不是 EditorAPI。FP-02-02 走的是 `editor.runShortcut`（EditorAPI 签名），两者签名不同。
- **cmExtensions 中 `null` 会让 createEditor 抛错**：`plugins.flatMap` 收集后作为 CM6 extension 数组传入，`null` 在 CM6 `Extension` 解构阶段抛 `Unrecognized extension value`。而 NexusPlugin 自身的 `shortcuts/slashCommands/widgets` 字段缺省时用 `?? []` 兜底，不会崩。
- **remark 插件异常传播路径**：`createEditor` 创建时同步跑 parser+remark 管道，插件抛错会直接导致 `createEditor` 抛错（与 CM6 update listener 吞异常不同）。`getAst()`/`exportHTML()` 也会带上转换结果。
- **`replaceSelection` 在初始光标 offset 0**：CM6 新建编辑器默认光标在 0，`replaceSelection` 插到文档开头（如 FP-02-02-N01 结果为 `"triggeredhello world"`）。
- **widget 仅在选区不与节点范围相交时折叠**：初始光标在首段落内时 code widget 渲染；光标移入块内后 widget 移除、源码恢复（`data-nexus-widget` 由 widget-extension 自动标记在 render 返回的根元素上）。
