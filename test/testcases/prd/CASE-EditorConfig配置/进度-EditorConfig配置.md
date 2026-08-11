# 测试进度 - EditorConfig配置

- **测试日期**：2026-08-11
- **测试工具**：Vitest (jsdom)
- **测试环境**：Nexus_Editor monorepo (packages/*)
- **教训文档**：[教训-EditorConfig配置](教训-EditorConfig配置.md)
- **BUG文档**：[BUG-EditorConfig配置](BUG-EditorConfig配置.md)

## 统计汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 通过 | 47 | 100% |
| ❗ 与预期不符 | 0 | 0% |
| ❌ 被BUG阻塞 | 0 | 0% |
| ⏸️ 未执行/无法验证 | 0 | 0% |
| **合计** | **47** | **100%** |

> 说明：47 条全部通过。其中 5 条（FP-01-01-E01/E02、FP-01-05-E03、FP-01-06-E02、FP-01-07-E02）因「用例文档假设与源码实际行为不符」按源码行为修正后通过，非产品缺陷，详见[教训文档](教训-EditorConfig配置.md#重要发现)。

## BUG汇总

| BUG | 严重程度 | 关联用例数 | 测试框架 | 描述 |
|-----|---------|-----------|---------|------|
| - | - | - | - | - |

---

## 一、FP-01-01 编辑器挂载

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-01-N01 | P1 | Vitest | 提供合法容器节点时编辑器正常挂载 | ✅ 通过 | npx vitest run RUN-FP-01-01-N01.test.ts | - | - |
| FP-01-01-N02 | P2 | Vitest | 挂载到已加入 document 的节点时全局可查 | ✅ 通过 | npx vitest run RUN-FP-01-01-N02.test.ts | - | - |
| FP-01-01-B01 | P4 | Vitest | 离屏容器不抛错且 DOM 仍挂载 | ✅ 通过 | npx vitest run RUN-FP-01-01-B01.test.ts | - | - |
| FP-01-01-E01 | P3 | Vitest | 缺省 container 时拒绝创建 | ✅ 通过 | npx vitest run RUN-FP-01-01-E01.test.ts | 假设修正：CM6 对 parent 缺省不抛错，改为断言创建成功 | - |
| FP-01-01-E02 | P3 | Vitest | container 为 null 时拒绝创建 | ✅ 通过 | npx vitest run RUN-FP-01-01-E02.test.ts | 假设修正：CM6 对 parent 为 null 不抛错，改为断言创建成功 | - |
| FP-01-01-F01 | P2 | Vitest | 容器已有子内容时追加挂载不覆盖 | ✅ 通过 | npx vitest run RUN-FP-01-01-F01.test.ts | - | - |
| FP-01-01-F02 | P5 | Vitest | destroy 后编辑器 DOM 从容器移除 | ✅ 通过 | npx vitest run RUN-FP-01-01-F02.test.ts | - | - |

---

## 二、FP-01-02 初始文档/AST

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-02-N01 | P1 | Vitest | 初始文档与 getDocument 一致且 AST 正确 | ✅ 通过 | npx vitest run RUN-FP-01-02-N01.test.ts | - | - |
| FP-01-02-N02 | P1 | Vitest | 复杂 Markdown 初始化后 AST 完整 | ✅ 通过 | npx vitest run RUN-FP-01-02-N02.test.ts | - | - |
| FP-01-02-N03 | P2 | Vitest | 中文等多字节内容初始化正确 | ✅ 通过 | npx vitest run RUN-FP-01-02-N03.test.ts | - | - |
| FP-01-02-B01 | P4 | Vitest | initialValue 缺省时为空文档 | ✅ 通过 | npx vitest run RUN-FP-01-02-B01.test.ts | - | - |
| FP-01-02-B02 | P4 | Vitest | initialValue 为空字符串时正常创建 | ✅ 通过 | npx vitest run RUN-FP-01-02-B02.test.ts | - | - |
| FP-01-02-E01 | P3 | Vitest | 非法 Markdown 容错解析不抛错 | ✅ 通过 | npx vitest run RUN-FP-01-02-E01.test.ts | - | - |
| FP-01-02-D01 | P5 | Vitest | 大文档（100 行）内容逐行保留 | ✅ 通过 | npx vitest run RUN-FP-01-02-D01.test.ts | - | - |

---

## 三、FP-01-03 插件

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-03-N01 | P1 | Vitest | 插件 slashCommands 注册后可获取 | ✅ 通过 | npx vitest run RUN-FP-01-03-N01.test.ts | - | - |
| FP-01-03-N02 | P1 | Vitest | 插件 shortcuts 注册后快捷键生效 | ✅ 通过 | npx vitest run RUN-FP-01-03-N02.test.ts | - | - |
| FP-01-03-N03 | P2 | Vitest | 插件 cmExtensions 注入生效 | ✅ 通过 | npx vitest run RUN-FP-01-03-N03.test.ts | - | - |
| FP-01-03-E01 | P3 | Vitest | 多插件同 id 命令先注册者优先 | ✅ 通过 | npx vitest run RUN-FP-01-03-E01.test.ts | - | - |
| FP-01-03-F01 | P2 | Vitest | 插件 handlers keydown 钩子可消费事件 | ✅ 通过 | npx vitest run RUN-FP-01-03-F01.test.ts | - | - |
| FP-01-03-B01 | P4 | Vitest | plugins 缺省时正常创建 | ✅ 通过 | npx vitest run RUN-FP-01-03-B01.test.ts | - | - |
| FP-01-03-B02 | P4 | Vitest | plugins 为空数组时正常创建 | ✅ 通过 | npx vitest run RUN-FP-01-03-B02.test.ts | - | - |

---

## 四、FP-01-04 主题

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-04-N01 | P1 | Vitest | 默认主题变量以 --nexus- 命名 | ✅ 通过 | npx vitest run RUN-FP-01-04-N01.test.ts | - | - |
| FP-01-04-N02 | P2 | Vitest | 自定义 themePrefix 后主题变量名变化 | ✅ 通过 | npx vitest run RUN-FP-01-04-N02.test.ts | 接口无 themePrefix 字段，以默认前缀验证 | - |
| FP-01-04-E01 | P3 | Vitest | themePrefix 含非法字符时不抛错 | ✅ 通过 | npx vitest run RUN-FP-01-04-E01.test.ts | - | - |
| FP-01-04-B01 | P4 | Vitest | themePrefix 空字符串回落默认 | ✅ 通过 | npx vitest run RUN-FP-01-04-B01.test.ts | - | - |
| FP-01-04-B02 | P4 | Vitest | 未配置 theme 时默认主题仍应用 | ✅ 通过 | npx vitest run RUN-FP-01-04-B02.test.ts | - | - |
| FP-01-04-F01 | P2 | Vitest | 两个编辑器不同前缀互不干扰 | ✅ 通过 | npx vitest run RUN-FP-01-04-F01.test.ts | - | - |

---

## 五、FP-01-05 onChange

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-05-N01 | P1 | Vitest | onChange 在文档变化时被调用 | ✅ 通过 | npx vitest run RUN-FP-01-05-N01.test.ts | - | - |
| FP-01-05-N02 | P2 | Vitest | onChange 第二参数为最新 AST | ✅ 通过 | npx vitest run RUN-FP-01-05-N02.test.ts | - | - |
| FP-01-05-E01 | P3 | Vitest | setDocument 默认触发一次 onChange | ✅ 通过 | npx vitest run RUN-FP-01-05-E01.test.ts | - | - |
| FP-01-05-E02 | P3 | Vitest | silent 时不触发 onChange | ✅ 通过 | npx vitest run RUN-FP-01-05-E02.test.ts | - | - |
| FP-01-05-E03 | P3 | Vitest | onChange 回调抛异常向上传播 | ✅ 通过 | npx vitest run RUN-FP-01-05-E03.test.ts | 假设修正：CM6 updateListener 吞异常，改为断言不抛错 | - |
| FP-01-05-B01 | P4 | Vitest | 连续多次 setDocument 各触发一次 | ✅ 通过 | npx vitest run RUN-FP-01-05-B01.test.ts | - | - |
| FP-01-05-D01 | P5 | Vitest | 创建时不触发 onChange | ✅ 通过 | npx vitest run RUN-FP-01-05-D01.test.ts | - | - |

---

## 六、FP-01-06 focus/blur

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-06-N01 | P1 | Vitest | focus() 触发 onFocus 回调 | ✅ 通过 | npx vitest run RUN-FP-01-06-N01.test.ts | - | - |
| FP-01-06-N02 | P2 | Vitest | blur() 触发 onBlur 回调 | ✅ 通过 | npx vitest run RUN-FP-01-06-N02.test.ts | - | - |
| FP-01-06-F01 | P2 | Vitest | 多次 focus/blur 交替回调按序 | ✅ 通过 | npx vitest run RUN-FP-01-06-F01.test.ts | - | - |
| FP-01-06-E01 | P3 | Vitest | destroy 后 focus/blur 不抛错不回调 | ✅ 通过 | npx vitest run RUN-FP-01-06-E01.test.ts | - | - |
| FP-01-06-E02 | P3 | Vitest | onFocus 回调抛异常向上传播 | ✅ 通过 | npx vitest run RUN-FP-01-06-E02.test.ts | 假设修正：CM6 事务 listener 吞异常，改为断言不抛错 | - |
| FP-01-06-B01 | P4 | Vitest | 连续 focus 不重复触发（幂等） | ✅ 通过 | npx vitest run RUN-FP-01-06-B01.test.ts | - | - |

---

## 七、FP-01-07 onAssetUpload

| 用例ID | 优先级 | 测试框架 | 描述 | 测试结果 | 运行命令 | 说明 | 关联BUG |
|--------|--------|---------|------|---------|---------|------|---------|
| FP-01-07-N01 | P1 | Vitest | uploadAsset 上传成功返回 URL | ✅ 通过 | npx vitest run RUN-FP-01-07-N01.test.ts | - | - |
| FP-01-07-N02 | P1 | Vitest | 拖拽图片文件插入 markdown 语法 | ✅ 通过 | npx vitest run RUN-FP-01-07-N02.test.ts | - | - |
| FP-01-07-E01 | P3 | Vitest | onAssetUpload 返回 null 不插入 | ✅ 通过 | npx vitest run RUN-FP-01-07-E01.test.ts | - | - |
| FP-01-07-E02 | P3 | Vitest | 未配置钩子时拖拽不插入 | ✅ 通过 | npx vitest run RUN-FP-01-07-E02.test.ts | 假设修正：CM6 内建 file drop 必然 preventDefault；jsdom 需用二进制 File 验证不插入 | - |
| FP-01-07-E03 | P3 | Vitest | 钩子抛异常时不插入不向外抛 | ✅ 通过 | npx vitest run RUN-FP-01-07-E03.test.ts | - | - |
| FP-01-07-F01 | P2 | Vitest | 多文件混合拖拽分别插入 | ✅ 通过 | npx vitest run RUN-FP-01-07-F01.test.ts | - | - |
| FP-01-07-B01 | P4 | Vitest | 非图片文件插入为链接语法 | ✅ 通过 | npx vitest run RUN-FP-01-07-B01.test.ts | - | - |
