# Nexus-Editor PR 提交说明 (PR Submission Guide)

本说明文档用于阐述本次面试考题中，新增功能的设计哲学、代码改动明细以及测试验证方案，以便于评审专家进行代码审查与质量评估。

---

## 1. 核心设计与项目定位的契合 (Alignment with Project Philosophy)

`Nexus-Editor` 的核心设计哲学是 **Headless (无头) 架构** 和 **AST-Driven (语法树驱动)**。本次新增的 **YAML Frontmatter 可视化编辑与高级属性面板** 功能完美贯彻了这一哲学：

1. **AST-Driven (语法树驱动)**：
   - **平滑扩展**：我们在 Lezer 语法树构建 mdast 的适配层中增加了前置扫描过滤逻辑。这能够将文档头部的 YAML 元数据精准抓取并转化成结构化的 `yaml` 语法树节点，避开了 Lezer 无法自带 frontmatter 解析的局限，保证了编辑器整个 AST 的纯净，避免了元数据区被错误解析为水平分割线或普通段落。
2. **Headless (无头隔离) 与高保真渲染**：
   - **极致的渲染与交互隔离**：Widget 的渲染完全是 headless 和无侵入的。在光标离开元数据区时，通过 `Decoration.replace` 折叠原文并替换为 `YamlWidget`。它以极具现代感的莫兰迪低饱和度多彩胶囊展示标签和别名，拥有精致的毛玻璃高保真外观，所有的视觉样式均采用完全隔离的行内样式编写，不依赖也不破坏宿主环境的 CSS。
    - **双向交互**：Widget 右上角内置了“✎ 编辑”按钮，点击后光标精准弹回至第 `0` 偏移（即 Frontmatter 首行），从而触发编辑器的 Live Preview 重塑逻辑，卡片无缝消失展开为 YAML 源码，实现了“在内源码、在外卡片”的丝滑编辑体验。
3. **YAML 语法行级诊断与异常拦截 (Diagnostics & Linting)**：
   - 贯彻了编辑器“开发稳定性与极致 UX”的宗旨。我们设计了零外部依赖的轻量 YAML 语法解析诊断机制，能够捕获属性缺失冒号、冒号后缺少空格、引号未闭合等五类常见语法错误，并提供高优先级的反馈：
     - **源码模式下 (Inline Diagnostic)**：采用波浪线装饰器，对出错行进行醒目的红色波浪线下划线行级高亮标记。
     - **折叠预览下 (Error Panel Widget)**：拦截属性卡片的正常渲染，转换为高度警示的错误提示面板，精准呈报错误行号与诱因，配合一键回弹按钮，保障用户数据输入的健壮性。
4. **元数据属性智能联想与非独占式补全源 (YAML Autocompletion)**：
   - 提供了针对 Frontmatter 区间的专门补全支持。采用 CodeMirror 6 标准的 `languageData` 动态分发机制，避免了覆写全局 autocomplete 配置导致与其他包（如 wikilinks 自动补全）冲突的问题，保证了协同并存。
   - 补全源在输入层进行物理区间拦截（仅在 Frontmatter 范围内且当前行未输入冒号分割时生效），根据前缀为 tags、aliases 智能补全列表语法，为 title、author 补全常规属性键，最大程度地提升了元数据录入的流畅度与体验。

---

## 2. 文件夹与文件改动明细 (Change Logs)

本次 PR 的所有修改均在 `packages/core` 内完成，保持了极高的内聚性，未污染其它外围包：

### 📂 新增的目录与文件
- **`md/`** (项目根目录下新增的测试结果目录)
  - 📄 [`YAML Frontmatter可视化渲染插件测试结果文档.md`](./md/YAML Frontmatter可视化渲染插件测试结果文档.md)：详细记录了六项核心特性的测试期望值、实际运行测试值的对比与测试结论。
- **`packages/core/test/`**
  - 📄 [`frontmatter.test.ts`](./packages/core/test/frontmatter.test.ts)：新增的单元测试套件，用以验证 YAML AST 节点解析、光标进出折叠状态切换、编辑按钮点击事件响应、YAML 语法错误诊断和高亮以及属性键联想补全。

### 📝 修改的文件及主要变动
- 📄 [`packages/core/src/types.ts`](./packages/core/src/types.ts)：
  - 新增 `Yaml` 接口继承自 mdast 节点。
  - 将 `Yaml` 追加至 `LivePreviewNode` 联合类型中，实现严格 TypeScript 类型安全。
- 📄 [`packages/core/src/lezer-mdast-adapter.ts`](./packages/core/src/lezer-mdast-adapter.ts)：
  - 新增 `findFrontmatterRange` 前置提取方法。
  - 修改 `walkRoot`，将首个 YAML 块转化为 `yaml` AST 节点，并在迭代子节点时跳过该区间，防范解析冲突。
- 📄 [`packages/core/src/live-preview-ranges.ts`](./packages/core/src/live-preview-ranges.ts)：
  - 将 `yaml` 注册到 `isLivePreviewNode` and `visit` 顶级节点收集管线中，跳过不必要的深度子节点遍历。
- 📄 [`packages/core/src/live-preview.ts`](./packages/core/src/live-preview.ts)：
  - 实现了 `parseYamlSimple` 解析与行级诊断方法（支持 tags 数组和 aliases 多行列表的智能还原，捕获五类语法格式异常）。
  - 实现了 `YamlWidget` 卡片与报错诊断面板渲染器，包含右上角跳转定位逻辑。
  - 实现了 `yamlCompletionSource` 智能补全源并以非独占的 `yamlCompletionLanguageData` 挂载，优化输入联想。
  - 在 `buildDecorations` 循环中引入 `yaml` 类型的拦截（通过 `selectionIntersects` 光标范围感应），控制折叠与展开状态，并在源码模式下应用红色波浪线进行行内高亮诊断。

---

## 3. 约束提示词指引 (AI Constraint Prompts)

为了保证后续在此项目上的 AI 助手能够具备同样优秀的代码风格、不破坏核心 headless 纯粹性、并完全遵循统一的开发及提交约束，我们在项目根目录下建立了一份约束配置文件：
- 📄 [`nexus-prompts.md`](./nexus-prompts.md)：全面融合了项目的 Scope 范围政策（禁止 AI 模块、禁止宿主 UI 组件及特定厂商 SDK 捆绑）、Commit 常规提交命名规约、Table Widget 12 条开发铁律，以及开发流程红线规则。

---

## 4. 本地验证与质量走查 (How to Test)

在项目根目录下，您可以执行以下步骤以进行本地代码与功能的验证：

1. **依赖重装与软链连接**：
   ```bash
   npx pnpm install
   ```
2. **运行 YAML Frontmatter 专用测试集**：
   ```bash
   npx pnpm --filter @floatboat/nexus-core test test/frontmatter.test.ts
   ```
   *(或者运行：`npx vitest run packages/core/test/frontmatter.test.ts`)*
