# 测试进度 - NexusPlugin插件接口

- **测试日期**：2026-08-11
- **测试工具**：Vitest (jsdom)
- **测试环境**：Nexus_Editor monorepo (packages/*)
- **教训文档**：[教训-NexusPlugin插件接口](教训-NexusPlugin插件接口.md)
- **BUG文档**：[BUG-NexusPlugin插件接口](BUG-NexusPlugin插件接口.md)

## 统计汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 38 | 100% |
| ❗ 与预期不符 | 0 | 0% |
| ❌ 被BUG阻塞 | 0 | 0% |
| ⏸️ 未执行/无法验证 | 0 | 0% |
| **合计** | **38** | **100%** |

> 说明：38 条全部通过。期间修正 3 处「用例文档假设与源码实现不符」：FP-02-03 的 5 条（N02/N03/D01/E01/B01，`/` 需位于行首或前面为空白才触发菜单）、FP-02-05-N01（render 主动把 source 写入 widget，断言改为验证行 DOM 中围栏源码消失）、FP-02-06-N03（jsdom 中 Mod 解析为 Ctrl）。均为测试 setup/断言修正，非产品缺陷。

## BUG汇总

| BUG | 严重程度 | 关联用例数 | 测试框架 | 描述 |
|-----|---------|-----------|---------|------|
| - | - | - | - | - |

---

## 一、FP-02-01 插件注册

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-01-N01 | P1 | Vitest | 注册单个命名插件正常创建渲染 | ✅ 通过 | npx vitest run RUN-FP-02-01-N01.test.ts | - | - |
| FP-02-01-N02 | P2 | Vitest | 多插件多 name 扩展聚合生效 | ✅ 通过 | npx vitest run RUN-FP-02-01-N02.test.ts | - | - |
| FP-02-01-E01 | P3 | Vitest | 缺失 name 运行时不崩溃 | ✅ 通过 | npx vitest run RUN-FP-02-01-E01.test.ts | - | - |
| FP-02-01-E02 | P3 | Vitest | 同名插件扩展均生效 | ✅ 通过 | npx vitest run RUN-FP-02-01-E02.test.ts | - | - |
| FP-02-01-B01 | P4 | Vitest | 超长 name 不影响创建 | ✅ 通过 | npx vitest run RUN-FP-02-01-B01.test.ts | - | - |
| FP-02-01-F01 | P2 | Vitest | 注册→生效→destroy 完整生命周期 | ✅ 通过 | npx vitest run RUN-FP-02-01-F01.test.ts | - | - |

---

## 二、FP-02-02 快捷键

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-02-N01 | P1 | Vitest | runShortcut 精确执行并返回 true | ✅ 通过 | npx vitest run RUN-FP-02-02-N01.test.ts | - | - |
| FP-02-02-N02 | P1 | Vitest | 键盘事件实际触发快捷键 | ✅ 通过 | npx vitest run RUN-FP-02-02-N02.test.ts | - | - |
| FP-02-02-N03 | P2 | Vitest | run 返回 false 未消费 | ✅ 通过 | npx vitest run RUN-FP-02-02-N03.test.ts | - | - |
| FP-02-02-E01 | P3 | Vitest | 未注册 key 返回 false | ✅ 通过 | npx vitest run RUN-FP-02-02-E01.test.ts | - | - |
| FP-02-02-E02 | P3 | Vitest | run 回调抛异常向外传播 | ✅ 通过 | npx vitest run RUN-FP-02-02-E02.test.ts | - | - |
| FP-02-02-B01 | P4 | Vitest | 相同 key 先注册者生效 | ✅ 通过 | npx vitest run RUN-FP-02-02-B01.test.ts | - | - |
| FP-02-02-F01 | P5 | Vitest | 快捷键改文档后 onChange 触发 | ✅ 通过 | npx vitest run RUN-FP-02-02-F01.test.ts | - | - |

---

## 三、FP-02-03 斜杠命令

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-03-N01 | P1 | Vitest | getSlashCommands 返回注册命令 | ✅ 通过 | npx vitest run RUN-FP-02-03-N01.test.ts | - | - |
| FP-02-03-N02 | P1 | Vitest | 输入 / 触发 slashMenuChange | ✅ 通过 | npx vitest run RUN-FP-02-03-N02.test.ts | 修正：`/` 需行首/空白前缀，改用 "start\n" + setSelection(6) | - |
| FP-02-03-N03 | P2 | Vitest | 输入 /hea 前缀过滤排序 | ✅ 通过 | npx vitest run RUN-FP-02-03-N03.test.ts | 同上 | - |
| FP-02-03-D01 | P2 | Vitest | 多插件命令按注册顺序聚合 | ✅ 通过 | npx vitest run RUN-FP-02-03-D01.test.ts | 同上 | - |
| FP-02-03-E01 | P3 | Vitest | slashMenuLimit 0 菜单空 | ✅ 通过 | npx vitest run RUN-FP-02-03-E01.test.ts | 同上 | - |
| FP-02-03-B01 | P4 | Vitest | 查询含空白时菜单关闭 | ✅ 通过 | npx vitest run RUN-FP-02-03-B01.test.ts | 同上（行首 / + 空格，验证空白关闭语义） | - |
| FP-02-03-F01 | P5 | Vitest | run 钩子修改文档流程 | ✅ 通过 | npx vitest run RUN-FP-02-03-F01.test.ts | - | - |

---

## 四、FP-02-04 remark 转换

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-04-N01 | P1 | Vitest | remark 插件修改 getAst() 输出 | ✅ 通过 | npx vitest run RUN-FP-02-04-N01.test.ts | - | - |
| FP-02-04-N02 | P2 | Vitest | exportHTML 反映转换结果 | ✅ 通过 | npx vitest run RUN-FP-02-04-N02.test.ts | - | - |
| FP-02-04-N03 | P2 | Vitest | setDocument 后 AST 仍经 remark | ✅ 通过 | npx vitest run RUN-FP-02-04-N03.test.ts | - | - |
| FP-02-04-E01 | P3 | Vitest | remark 抛异常导致创建失败 | ✅ 通过 | npx vitest run RUN-FP-02-04-E01.test.ts | - | - |
| FP-02-04-B01 | P4 | Vitest | 多 remark 插件按序执行 | ✅ 通过 | npx vitest run RUN-FP-02-04-B01.test.ts | - | - |
| FP-02-04-D01 | P3 | Vitest | 仅改 AST 文档源码无损 | ✅ 通过 | npx vitest run RUN-FP-02-04-D01.test.ts | - | - |

---

## 五、FP-02-05 widget

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-05-N01 | P1 | Vitest | 匹配节点渲染为自定义 widget | ✅ 通过 | npx vitest run RUN-FP-02-05-N01.test.ts | 修正：render 显示 source，断言改为行 DOM 围栏源码消失 | - |
| FP-02-05-N02 | P1 | Vitest | 光标进入 widget 范围恢复源码 | ✅ 通过 | npx vitest run RUN-FP-02-05-N02.test.ts | - | - |
| FP-02-05-N03 | P2 | Vitest | match 谓词精确筛选 | ✅ 通过 | npx vitest run RUN-FP-02-05-N03.test.ts | - | - |
| FP-02-05-E01 | P3 | Vitest | widget 移除时调用 destroy | ✅ 通过 | npx vitest run RUN-FP-02-05-E01.test.ts | - | - |
| FP-02-05-B01 | P4 | Vitest | 无匹配节点不渲染 | ✅ 通过 | npx vitest run RUN-FP-02-05-B01.test.ts | - | - |
| FP-02-05-D01 | P3 | Vitest | render 的 source 与源码一致 | ✅ 通过 | npx vitest run RUN-FP-02-05-D01.test.ts | - | - |

---

## 六、FP-02-06 cmExtensions

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-02-06-N01 | P1 | Vitest | editorAttributes 注入根节点 | ✅ 通过 | npx vitest run RUN-FP-02-06-N01.test.ts | - | - |
| FP-02-06-N02 | P1 | Vitest | ViewPlugin 实例化可访问状态 | ✅ 通过 | npx vitest run RUN-FP-02-06-N02.test.ts | - | - |
| FP-02-06-N03 | P1 | Vitest | keymap 绑定生效 | ✅ 通过 | npx vitest run RUN-FP-02-06-N03.test.ts | 修正：jsdom 中 Mod 解析为 Ctrl，改用 ctrlKey | - |
| FP-02-06-E01 | P3 | Vitest | 非法 extension 创建失败 | ✅ 通过 | npx vitest run RUN-FP-02-06-E01.test.ts | - | - |
| FP-02-06-B01 | P4 | Vitest | 空 cmExtensions 安全注册 | ✅ 通过 | npx vitest run RUN-FP-02-06-B01.test.ts | - | - |
| FP-02-06-B02 | P4 | Vitest | 多插件 cmExtensions 合并生效 | ✅ 通过 | npx vitest run RUN-FP-02-06-B02.test.ts | - | - |
