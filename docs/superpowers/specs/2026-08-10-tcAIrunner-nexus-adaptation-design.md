# tcAIrunner Nexus_Editor 适配设计

> 将 tcAIrunner（原 Web 应用测试执行器）改造为 Nexus_Editor 引擎库专属的测试用例 AI 对话执行器。

---

## 1. 背景

### 1.1 原 tcAIrunner 的定位

原 tcAIrunner 是为 Web 应用（成果转化系统）设计的测试执行器：
- 用 `playwright-cli` 有头模式导航到部署的 Web URL
- 需要登录、处理角色权限
- 测试方式是浏览器操作（点击按钮、填表单、调服务器 API）
- 串行执行用例，实时产出教训/BUG/进度三件套

### 1.2 Nexus_Editor 的差异

Nexus_Editor 是一个 Markdown 编辑器引擎库（TypeScript monorepo），与 Web 应用有根本性差异：

| 维度 | 原 Web 应用 | Nexus_Editor |
|------|------------|-------------|
| 测试对象 | 部署的 Web 系统 | 引擎库的 API 和 Electron demo UI |
| 登录 | 多角色登录 | 无登录 |
| 测试环境 | 外部 URL | jsdom（Vitest）+ 本地 Electron（Playwright） |
| 测试框架 | playwright-cli 单一 | Vitest（单元）+ Playwright（e2e）双框架 |
| 用例来源 | 手写 MD | fp2tc 生成的增强格式 MD |
| 用例内容 | 浏览器操作步骤 | setup 代码 + 步骤表 + 断言标记 |

### 1.3 fp2tc 输出的用例格式

fp2tc 生成的测试用例 MD 包含：
- **测试框架字段**：`Vitest` 或 `Playwright`
- **前置条件4要素**：依赖环境、初始文档、插件配置、setup 代码（含完整 import 和初始化）
- **三列式步骤表**：步骤 / 操作 / 预期结果 / 自动化信息
- **断言标记**：`[API]` `[AST]` `[DOM]` `[STATE]` `[CALC]` `[EVENT]`
- **自动化信息**：import 路径、API 方法签名、框架、等待条件

### 1.4 改造目标

保留原 tcAIrunner 的核心价值（串行执行、三件套产出、异常处理选项、对话式调试循环），将执行层从"Web 浏览器操作"替换为"Nexus_Editor 双框架混合执行"。

---

## 2. 总体架构：双通道分离

### 2.1 核心理念

保留原 tcAIrunner 的骨架（阶段0~4 串行循环 + 教训/BUG/进度三件套 + 异常处理选项），将**执行层**从"Web 浏览器操作"替换为"Nexus_Editor 双框架混合执行"。

### 2.2 架构图

```
用例 MD 文件（fp2tc 格式 或 手写兼容）
         │
    阶段1: 解析 → 按章节树状选择用例
         │
    阶段1.5: 初始化三件套产出文档
         │
    ┌─────┴─────┐
     每条用例判断「测试框架」字段
     │                    │
 Vitest 通道          Playwright/e2e 通道
 │                    │
 MD步骤表+setup代码    MD步骤表+前置条件
 → 生成 .test.ts      → MCP 工具操作 Electron demo
 → pnpm test 子进程    → 逐步截图/快照验证
 → 解析 JUnit JSON     → 对话式逐步判定
 → 判定通过/失败       → 判定通过/失败
     │                    │
     └─────┬─────┘
      阶段3.6: 更新三件套
      阶段4: 最终检查
```

### 2.3 与 fp2tc 的关系

- **上游**：fp2tc 生成的 CASE MD 文件是 tcAIrunner 的标准输入
- **fp2tc 已做的工作**：步骤表三列式、断言标记、setup 代码、import 路径、测试框架判定——tcAIrunner 直接利用这些信息，无需重新推断
- **tcAIrunner 不做的事**：不生成测试用例规范（那是 fp2tc 的职责），只执行已写好的用例规范

---

## 3. 各阶段改造细节

### 3.1 阶段0：启动必读（改造）

**移除项**：
- ~~users.md 账号文件~~（无登录）
- ~~测试环境 URL~~（无外部服务器）
- ~~references/用例执行指令.md~~（Web 专属铁律）

**新增/替换**：

| 读取项 | 来源 | 用途 |
|--------|------|------|
| references/nexus-test-patterns.md | 新建（复用 fp2tc 的 test-patterns.md 核心内容） | Vitest/Playwright setup 模式、DOM 选择器、包导入映射 |
| references/output-spec.md | 改造自原 测试执行规范.md | 三件套产出物模板（去掉 Web 专属字段，加 Nexus 字段） |
| AGENTS.md Table Widget 规则 | 项目根目录 | 表格相关用例的已知陷阱 |

文件查找容错规则保留：文件不存在时暂停并 AskUserQuestion。

### 3.2 阶段1：解析用例文件与用例选择（基本保留）

唯一改动：用例编号格式兼容 fp2tc 的 `FP-XX-YY-{类型}{序号}`（如 `FP-01-01-N01`）。树状选择界面逻辑不变。

### 3.3 阶段1.5：初始化产出文档（改造命名规则）

产出文档与 fp2tc 输出目录对齐，放入 CASE 文件同目录：

```
test/testcases/{change-id}/CASE-{功能点名}/
├── CASE-{功能点名}-测试用例.md          ← fp2tc 生成（输入）
├── RUN-{用例ID}.test.ts                 ← tcAIrunner 生成（Vitest 用例）
├── 教训-{功能点名}.md                    ← tcAIrunner 生成（产出）
├── BUG-{功能点名}.md                     ← tcAIrunner 生成（产出）
└── 进度-{功能点名}.md                    ← tcAIrunner 生成（产出）
```

兄弟模块教训搜索路径改为 `test/testcases/{change-id}/CASE-*/教训-*.md`。

### 3.4 阶段2：准备环境（根本性改造）

**Vitest 通道准备**（无需额外准备）：
- jsdom 环境由 vitest.config.ts 自动提供
- 项目已有的 alias 配置自动解析所有 `@floatboat/*` 包

**Playwright 通道准备**：
1. 检查 dev server 是否已在运行（检查 localhost:5173）
2. 未运行 → 启动 `pnpm dev:electron-demo`（后台非阻塞）
3. 等待 `.cm-content` 可用
4. 不需要登录、不需要清除 cookie

### 3.5 阶段3：执行循环（核心改造）

#### 3.5.1 环境重置（3.1）

- Vitest → 天然隔离（每个 test 独立 jsdom），无需重置
- Playwright → 每条用例前清除编辑器内容（`page.click(".cm-content")` + `Meta+A` + `Delete`）

#### 3.5.2 前置条件处理（3.2）

前置条件4要素改为 Nexus 版：
- **依赖环境**：jsdom（Vitest）/ Electron demo（Playwright）
- **初始文档**：起始 markdown 内容
- **插件配置**：需要加载的 plugin 列表
- **setup 代码**：createEditor 初始化代码（不再有"角色权限"字段）

#### 3.5.3 Vitest 通道执行（3.3V）

```
1. 解析用例 MD 的 setup 代码块 + 步骤表 + 断言标记
2. AI 将步骤翻译为可执行的 .test.ts 代码:
   - import 语句（从「自动化信息」列提取）
   - describe/it 结构
   - setup（createEditor + 插件加载）
   - 每个步骤 → API 调用 + expect 断言
   - afterEach 清理（editor.destroy()）
3. 写入文件: RUN-{用例ID}.test.ts
4. 运行: npx vitest run {文件路径} --reporter=json 2>&1
5. 解析 JSON 结果:
   - 通过 → ✅
   - 失败 → 提取 assertion 差异，进入异常处理选项
```

#### 3.5.4 Playwright 通道执行（3.3P）

```
1. 解析用例 MD 的步骤表 + 前置条件
2. 使用 Playwright MCP 工具逐步操作:
   - playwright_navigate / playwright_click / playwright_fill
   - 每步后 playwright_screenshot 或 playwright_get_visible_text 验证
3. 关键步骤（[UI]/[DOM]/[STATE]）→ 截图 + 可见文本断言
4. 非关键步骤 → 只执行不验证
5. 异常 → 进入异常处理选项（同原版）
```

#### 3.5.5 异常处理（3.4）

保留原版的5个选项：重试当前步骤 / 跳过当前步骤 / 认定为BUG / 跳过当前用例 / 终止执行。

#### 3.5.6 用例结果判定（3.5）

| 情况 | 标记 |
|------|------|
| 所有关键步骤验证通过 | ✅ 通过 |
| 部分关键步骤与预期不符 | ❗ 与预期不符 |
| 被BUG阻塞 | ❌ 被BUG阻塞 |
| 前置条件无法满足 | ⏸️ 无法验证 |
| 有步骤跳过但不影响核心功能 | ⚠️ 部分通过 |

#### 3.5.7 更新产出文档（3.6-3.9）

逻辑不变，按 references/output-update-rules.md 规则更新。

### 3.6 阶段4：最终检查与清理

移除 `playwright-cli close`，改为：
- Vitest 通道 → 清理临时 RUN-*.test.ts 文件（可选，询问用户保留或删除）
- Playwright 通道 → 无需手动关闭（dev server 由用户管理）

---

## 4. Vitest 代码生成规则

### 4.1 翻译映射规则

| 用例 MD 元素 | .test.ts 对应 |
|-------------|--------------|
| setup 代码块 | 直接复用为每个 `it()` 内的 setup（不跨 it 共享，保证隔离） |
| 步骤行 | 一个 `it()` 测试 |
| 断言标记 `[API]` | `expect(editor.xxx()).toBe(...)` |
| 断言标记 `[AST]` | `expect(ast.children[n]?.type).toBe(...)` |
| 断言标记 `[DOM]` | `expect(container.querySelector(".cm-xxx")).not.toBeNull()` |
| 断言标记 `[STATE]` | `expect(view.state.field(...)).toBe(...)` |
| 断言标记 `[EVENT]` | `expect(events).toEqual([...])` |
| 断言标记 `[CALC]` | `expect(result).toBe(数值)` |
| `afterEach` | 固定写入 `vi.useRealTimers()` + `editor.destroy()` |
| import | 从 setup 代码和「自动化信息」列提取，去重 |

### 4.2 代码生成失败的处理

当 AI 无法将某个步骤翻译为明确的断言时：
1. 生成代码中用 `// TODO: 断言描述不明确，需人工确认` 标注
2. 对应 `it()` 内写最小化的 `expect(true).toBe(true)` 占位
3. 在教训文档中记录"翻译模糊"发现
4. 运行后该测试算 ⚠️ 部分通过（有 TODO 标注）

### 4.3 运行命令与结果解析

```bash
npx vitest run {文件路径} --reporter=json 2>&1
```

从 JSON 输出中提取：
- `numTotalTests` / `numPassedTests` / `numFailedTests`
- 每个失败用例的 `fullName` + `failureMessages[0]`
- 全部通过 → ✅；有失败 → ❗ 与预期不符（附 assertion 差异）

---

## 5. Playwright MCP 工具映射

### 5.1 操作映射表

| 用例操作 | MCP 工具 | 示例 |
|---------|---------|------|
| 点击编辑器 | playwright_click | selector: `.cm-content` |
| 输入文本 | playwright_evaluate | `document.execCommand("insertText", false, "text")` |
| 键盘按键 | playwright_press_key | key: `Enter` / `Meta+f` |
| 验证可见性 | playwright_get_visible_text | 搜索预期文本 |
| 截图验证 | playwright_screenshot | 保存关键步骤截图 |
| 断言 [DOM] | playwright_get_visible_html | 获取 HTML 检查选择器 |

导航目标：`http://localhost:5173`（Vite dev server）。

### 5.2 DOM 选择器参考

| 选择器 | 含义 |
|--------|------|
| `.cm-editor` | 编辑器根容器 |
| `.cm-content` | 可编辑内容区 |
| `.cm-line` | 每行 |
| `.cm-cursor` | 光标 |
| `.nexus-slash-menu` | 斜杠菜单容器 |
| `table[role='grid']` | Live Preview 表格 |
| `[role='heading']` | Live Preview 标题 |

---

## 6. Self-Improving 机制

与 fp2tc/req2fp 对齐，加入 Self-Improving 闭环。

### 6.1 Step -1: 加载历史教训

- 读取 `~/self-improving/memory.md`（通用教训）
- 读取 `~/self-improving/domains/tcAIrunner.md`（测试执行专属教训）
- 检查 corrections.md 计数≥2 的待注入教训

### 6.2 阶段4 后追加 Step 5: 教训汇入

- 收集本轮问题：代码翻译错误、运行失败的模式、Playwright 操作超时、断言翻译模糊
- 写入 `~/self-improving/corrections.md`
- 计数≥2 的教训询问用户是否注入 SKILL.md

---

## 7. references 文件改造清单

| 原文件 | 改造操作 |
|--------|---------|
| 用例执行指令.md | **删除**（Web 专属铁律不适用） |
| 测试执行规范.md | **重写**为 output-spec.md（去掉 Web 模板字段，加 Nexus 字段） |
| execution-steps.md | **重写**为双通道版（Vitest 代码生成规则 + Playwright MCP 映射） |
| output-update-rules.md | **小改**（文件命名规则调整） |
| precondition-handling.md | **重写**（4 要素改为 Nexus 版） |
| — | **新建** nexus-test-patterns.md（复用 fp2tc 的 test-patterns.md） |

---

## 8. 产出文档模板调整要点

### 8.1 教训文档

去掉「发现类型」中的"流程确认"，增加"代码翻译"、"断言模糊"。

### 8.2 BUG 文档

严重度标准调整：
- **高**：引擎 API 返回错误结果 / AST 解析错误
- **中**：Live Preview 渲染与预期不符 / 事件未触发
- **低**：CSS 样式差异 / 文案差异

### 8.3 进度文档

增加「测试框架」列和「运行命令」列。

---

## 9. 输入兼容性

### 9.1 fp2tc 格式（标准输入）

完整识别所有字段：测试框架、前置条件4要素、步骤表三列式、断言标记、自动化信息。

### 9.2 手写格式（兼容输入）

放宽要求：
- 必须有步骤表（至少：步骤 / 操作 / 预期结果 三列）
- 可无「自动化信息」列 → AI 运行时推断
- 可无「测试框架」字段 → AI 根据操作内容推断（涉及 DOM 选择器和浏览器交互→Playwright，涉及 API 调用→Vitest）
- 可无 setup 代码 → AI 根据初始文档描述生成最小 setup
- 可无断言标记 → AI 从"预期结果"文字描述推断验证方式
