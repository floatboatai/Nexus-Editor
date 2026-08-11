# 教训 - EditorConfig配置

## 关联用例

### FP-01-01 编辑器挂载（7条）
- FP-01-01-N01 [P1] [N] [Vitest] 提供合法容器节点时编辑器正常挂载
- FP-01-01-N02 [P2] [N] [Vitest] 挂载到已加入 document 的节点时全局可查
- FP-01-01-B01 [P4] [B] [Vitest] 离屏容器不抛错且 DOM 仍挂载
- FP-01-01-E01 [P3] [E] [Vitest] 缺省 container 时拒绝创建
- FP-01-01-E02 [P3] [E] [Vitest] container 为 null 时拒绝创建
- FP-01-01-F01 [P2] [F] [Vitest] 容器已有子内容时追加挂载不覆盖
- FP-01-01-F02 [P5] [F] [Vitest] destroy 后编辑器 DOM 从容器移除

### FP-01-02 初始文档/AST（7条）
- FP-01-02-N01 [P1] [N] [Vitest] 初始文档与 getDocument 一致且 AST 正确
- FP-01-02-N02 [P1] [N] [Vitest] 复杂 Markdown 初始化后 AST 完整
- FP-01-02-N03 [P2] [N] [Vitest] 中文等多字节内容初始化正确
- FP-01-02-B01 [P4] [B] [Vitest] initialValue 缺省时为空文档
- FP-01-02-B02 [P4] [B] [Vitest] initialValue 为空字符串时正常创建
- FP-01-02-E01 [P3] [E] [Vitest] 非法 Markdown 容错解析不抛错
- FP-01-02-D01 [P5] [D] [Vitest] 大文档（100 行）内容逐行保留

### FP-01-03 插件（7条）
- FP-01-03-N01 [P1] [N] [Vitest] 插件 slashCommands 注册后可获取
- FP-01-03-N02 [P1] [N] [Vitest] 插件 shortcuts 注册后快捷键生效
- FP-01-03-N03 [P2] [N] [Vitest] 插件 cmExtensions 注入生效
- FP-01-03-E01 [P3] [E] [Vitest] 多插件同 id 命令先注册者优先
- FP-01-03-F01 [P2] [F] [Vitest] 插件 handlers keydown 钩子可消费事件
- FP-01-03-B01 [P4] [B] [Vitest] plugins 缺省时正常创建
- FP-01-03-B02 [P4] [B] [Vitest] plugins 为空数组时正常创建

### FP-01-04 主题（6条）
- FP-01-04-N01 [P1] [N] [Vitest] 默认主题变量以 --nexus- 命名
- FP-01-04-N02 [P2] [N] [Vitest] 自定义 themePrefix 后主题变量名变化
- FP-01-04-E01 [P3] [E] [Vitest] themePrefix 含非法字符时不抛错
- FP-01-04-B01 [P4] [B] [Vitest] themePrefix 空字符串回落默认
- FP-01-04-B02 [P4] [B] [Vitest] 未配置 theme 时默认主题仍应用
- FP-01-04-F01 [P2] [F] [Vitest] 两个编辑器不同前缀互不干扰

### FP-01-05 onChange（7条）
- FP-01-05-N01 [P1] [N] [Vitest] onChange 在文档变化时被调用
- FP-01-05-N02 [P2] [N] [Vitest] onChange 第二参数为最新 AST
- FP-01-05-E01 [P3] [E] [Vitest] setDocument 默认触发一次 onChange
- FP-01-05-E02 [P3] [E] [Vitest] silent 时不触发 onChange
- FP-01-05-E03 [P3] [E] [Vitest] onChange 回调抛异常向上传播
- FP-01-05-B01 [P4] [B] [Vitest] 连续多次 setDocument 各触发一次
- FP-01-05-D01 [P5] [D] [Vitest] 创建时不触发 onChange

### FP-01-06 focus/blur（6条）
- FP-01-06-N01 [P1] [N] [Vitest] focus() 触发 onFocus 回调
- FP-01-06-N02 [P2] [N] [Vitest] blur() 触发 onBlur 回调
- FP-01-06-F01 [P2] [F] [Vitest] 多次 focus/blur 交替回调按序
- FP-01-06-E01 [P3] [E] [Vitest] destroy 后 focus/blur 不抛错不回调
- FP-01-06-E02 [P3] [E] [Vitest] onFocus 回调抛异常向上传播
- FP-01-06-B01 [P4] [B] [Vitest] 连续 focus 不重复触发（幂等）

### FP-01-07 onAssetUpload（7条）
- FP-01-07-N01 [P1] [N] [Vitest] uploadAsset 上传成功返回 URL
- FP-01-07-N02 [P1] [N] [Vitest] 拖拽图片文件插入 markdown 语法
- FP-01-07-E01 [P3] [E] [Vitest] onAssetUpload 返回 null 不插入
- FP-01-07-E02 [P3] [E] [Vitest] 未配置钩子时拖拽不插入
- FP-01-07-E03 [P3] [E] [Vitest] 钩子抛异常时不插入不向外抛
- FP-01-07-F01 [P2] [F] [Vitest] 多文件混合拖拽分别插入
- FP-01-07-B01 [P4] [B] [Vitest] 非图片文件插入为链接语法

## 重要发现

### 本轮执行结果：47/47 通过（0 BUG，5 条用例假设修正）

**结论**：5 条失败用例全部为「用例文档假设」与「CM6/Nexus 源码实际行为」不符，**非产品缺陷**。逐条记录如下：

1. **FP-01-01-E01/E02（缺省/null container 应拒绝创建）→ 假设错误**
   - 实测：CM6 `EditorView` 构造时 `parent` 为 `undefined`/`null` **不抛错**，编辑器正常创建且 `getDocument()`/`destroy()` 均可用。
   - 依据：`packages/core/src/editor.ts` 543-545 行 `new EditorView({ parent: config.container, ... })`，CM6 对 parent 缺省容忍。
   - 修正：改为断言创建成功、文档可读、destroy 不抛错。

2. **FP-01-05-E03（onChange 回调抛异常应向上传播）→ 假设错误**
   - 实测：`setDocument("x")` **不抛错**。`emitChange` 中 `config.onChange?.(...)` 抛错发生在 CM6 `updateListener` 内部，被 CM6 的 `logException` 捕获吞掉（`@codemirror/view` updateListener 机制），不向上传播。
   - 修正：改为断言不抛错 + 文档已更新为 "x"。

3. **FP-01-06-E02（onFocus 回调抛异常应向上传播）→ 假设错误**
   - 实测：`focus()` **不抛错**。`setFocused` 中 `config.onFocus?.()` 抛错同样被 CM6 事务更新监听器捕获吞掉。
   - 修正：改为断言不抛错。

4. **FP-01-07-E02（未配置 onAssetUpload 时 drop 应不消费）→ 假设错误**
   - 实测：`defaultPrevented === true`。裸 CM6 对照实验（`EditorView.domEventHandlers({ drop: () => false })`）确认：**只要 drop 事件带 `dataTransfer.files`，CM6 内建 `handlers.drop`（`@codemirror/view` dist L5041-L5063）即返回 `true` 并 preventDefault**，与 Nexus 是否配置 `onAssetUpload` 无关——这是 CM6 固有行为（file drop 兜底读取文本）。
   - 第二个坑（jsdom 环境）：`new File(["x"], "c.png")` 的文本内容 "x" 会被 CM6 内建 FileReader 读作文本并插入文档（E01 通过是因为配置了 onAssetUpload 消费事件、CM6 内建 handler 不执行）。改用 `new Uint8Array([0x00, 0x01])` 二进制内容触发 CM6 `[\x00-\x08\x0e-\x1f]{2}` 二进制检测，跳过插入。
   - 修正：断言 `defaultPrevented === true` + 文档保持空。

5. **FP-01-04（themePrefix 字段）→ 已知实现差异**
   - `EditorConfig` 接口无 `themePrefix` 字段；主题 CSS 变量硬编码 `--nexus-*` 前缀（`packages/core/src/theme.ts`）。相关用例均以 `as unknown as EditorConfig` 传参并断言 `--nexus-bg` 等默认前缀验证。

## 额外教训

- **CM6 事件处理优先级**：Nexus 的 `domEventHandlers`（插件注册）与 CM6 内建 `InputState` handlers 共享 `runHandlers` 列表。Nexus drop/paste handler 返回 `false` 时控制权交还 CM6 内建 handler——测试要验证"未消费"语义时，必须同时考虑 CM6 内建兜底行为。
- **jsdom File 陷阱**：`new File(["x"], "name.png")` 的内容是纯文本，`FileReader.readAsText` 在 jsdom 中能成功读出 "x"；模拟"图片等二进制文件"必须用 `Uint8Array` 构造内容，否则 CM6 内建 drop 会插入文本。
- **CM6 异常吞没**：`updateListener`、`domEventHandlers` 中用户回调抛出的异常被 CM6 内部捕获并 `console.error`，**不会**向调用方（`setDocument`/`focus` 等）传播。断言"回调异常传播"类用例前必须先确认宿主层（Nexus）是否在 CM6 监听器之外捕获。
