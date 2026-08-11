# fp2tc 改造为 Nexus_Editor 专属技能 — 设计文档

## 背景

当前 `fp2tc/` 技能从 Web 应用测试生成器（原 `function-points-to-testcases`）直接复制而来，其中大量概念与 Nexus_Editor（TypeScript 编辑器库 monorepo）不匹配：

- 断言标记面向 Web UI（CSS 选择器、API 端点、DB 记录），而非编辑器库 API
- 增强阶段依赖 `RAG/code-knowledge/` JSON 知识库，项目中不存在
- 前置条件围绕"创建项目数据/登录角色"，而非"初始化 editor/加载插件"
- 测试类型仅 Playwright UI，不支持 Vitest 单元测试
- references 中的模块映射、设计规范均为专利/成果转化等业务场景

## 目标

将 `fp2tc/` 改造为适配 Nexus_Editor 的测试用例生成技能，使其能：

1. 接收 req2fp 生成的功能点文件（`test/function_points/`），生成面向自动化执行的测试用例
2. 支持 Vitest 单元测试和 Playwright e2e 两种测试类型
3. 阶段 B 直接读 `packages/` 源码进行增强（API 签名、import 路径、类型定义、已知陷阱）
4. 断言标记和前置条件适配编辑器库语义

## 改造范围

### 1. SKILL.md 主体改造

#### 1.1 断言标记替换

| 原标记（Web 应用） | 新标记（编辑器库） | 含义 |
|---------------------|---------------------|------|
| [UI] CSS 选择器 | [DOM] CM6 DOM 元素 | `.cm-editor`、`.cm-content`、Widget DOM |
| [API] HTTP 端点 | [API] EditorAPI 方法 | `editor.getDocument()`、`editor.setDocument()` |
| [DB] 数据库记录 | [AST] mdast 节点 | `ast.children[0].type === "heading"` |
| [STATE] 业务状态 | [STATE] 编辑器状态 | CM6 dispatch、selection、editing flag |
| [CALC] 计算结果 | [CALC] 计算结果 | 字数统计、表格列数 |
| —（新增） | [EVENT] 事件触发 | onChange、onFocus、onBlur 回调 |

#### 1.2 前置条件 4 要素改造

| 原要素 | 新要素 |
|--------|--------|
| 依赖数据（项目名称、ID） | 依赖环境（jsdom / Electron demo） |
| 系统状态（页面路由） | 初始文档 / 编辑器状态 |
| 角色权限（账号角色） | 插件配置（加载哪些 plugin） |
| 创建过程（UI/API 创建数据） | setup 代码（import + createEditor + 初始 markdown） |

#### 1.3 测试框架自动判定

根据功能点类型标签自动推荐测试框架：

| 类型标签（来自 req2fp） | 推荐框架 | 理由 |
|------------------------|---------|------|
| [API契约] [AST解析] | Vitest | 纯逻辑，无需 DOM 交互 |
| [编辑交互] | Vitest | jsdom + CM6 dispatch |
| [Live Preview] | Vitest | Decoration / DOM 查询 |
| [插件能力] | Vitest | 插件注册逻辑 |
| [数据IO] [Vault] | Playwright | Electron 文件系统 |
| [无障碍] | Playwright | 需要 ARIA / 真实键盘 |
| [安全] | Vitest | XSS 注入测试 |
| [性能] | Vitest | 大文档 benchmark |

#### 1.4 设计规范摘要重写

用例数量规则保留不变（简单 5-8 / 中等 8-10 / 复杂 10-20），但：
- 删除"审核流程需多角色协作"等 Web 应用业务规则
- 新增编辑器库特有规则（如：每个公开 API 方法至少 1 个正常用例 + 1 个异常用例；CM6 交互需注意 editing flag 生命周期）

#### 1.5 阶段 B 增强：源码直读模式

子智能体 Prompt 模板改造：
- 不再查询 `RAG/code-knowledge/` JSON 文件
- Grep 搜索 `packages/*/src/*.ts` 中的 API 方法签名
- Grep 搜索 `packages/*/test/*.test.ts` 中相似测试的 setup pattern
- 从 `AGENTS.md` 提取已知陷阱（Table Widget 12 条铁律等）
- 从 `packages/core/src/types.ts` 提取类型定义

#### 1.6 输出目录改造

```
test/testcases/{模块名}/CASE-{功能点名}/CASE-{功能点名}-测试用例.md
```

#### 1.7 编号规则

保留 `FP-{全局批次序号}-{二级序号}-{类型后缀}{序号}` 格式，与 req2fp 的 `FP-{一级}-{二级}` 对齐。

### 2. references/ 改造

| 文件 | 操作 | 说明 |
|------|------|------|
| `module-mapping.md` | 删除 | 专利/成果转化模块映射无关 |
| `design-guide-case.md` | 删除 | Web 应用设计规范无关 |
| `test-patterns.md` | 新增 | Nexus_Editor 测试模式参考 |
| `corrections.md` | 清空重置 | 移除 Web 应用专属教训 |

### 3. 与 req2fp 的衔接

保留 Step 4 衔接逻辑，但更新：
- 输入源：`test/function_points/FP-<change-id>-功能点.md`
- 类型标签直接来自 req2fp 的 12 种引擎库分类
- 类型标签 → 测试框架的映射由 fp2tc 内部处理

## 不改变的部分

- 铁律体系（13 条，仅微调术语）
- 执行流程结构（Step -1 → Step 0 → 阶段 A → 阶段 B → Step B5）
- 子智能体并行模式 + STATS 统计块
- Self-Improving 教训闭环
- A3 / B4 硬阻断检查清单机制
