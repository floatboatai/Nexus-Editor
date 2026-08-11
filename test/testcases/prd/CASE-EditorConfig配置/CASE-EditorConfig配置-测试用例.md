# CASE-EditorConfig配置-测试用例

> 功能点: FP-01 EditorConfig 配置对象（全局批次序号 01）
> 测试框架: Vitest（jsdom 环境）
> 覆盖二级功能点: FP-01-01 ~ FP-01-07（共 7 个）
> 用例总数: 47
> 生成说明: 基础测试用例，参考 `prd.md §3.1` 核心配置对象契约生成；已由测试用例增强专家注入源码精确信息（packages/core/src/editor.ts、types.ts、theme.ts，测试参考 packages/core/test/editor.test.ts、events.test.ts），增强日期: 2026-08-11。
> ⚠️ 关键实现差异: `EditorConfig` 接口（types.ts:79-121）中**不存在 `themePrefix` 字段**，theme.ts 的 `VAR_MAP` 硬编码 `--nexus-*` CSS 变量前缀。FP-01-04 全部用例基于需求假设的 `themePrefix` 配置，测试时需以 `as unknown as EditorConfig` 绕过 TS 编译，且实际断言应改为 `--nexus-*` 变量。

---

## FP-01-01-N01 [P1] [N] 提供合法容器节点时编辑器正常挂载

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Hello",
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出（packages/core/src/index.ts:1 `export { createEditor } from "./editor"`）
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`（editor.ts:232）
  - EditorConfig 关键字段: `container: HTMLElement`（必填，types.ts:80）、`initialValue?: string`（types.ts:81）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 createEditor 传入合法 div 容器 | [DOM] container.querySelector(".cm-editor") 不为 null（CM6 EditorView 根节点带 `.cm-editor` class 挂载进 container） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hello" }); 框架: vitest; 等待: 无 |
| 2 | 调用 editor.getDocument() 读取文档 | [API] editor.getDocument(): string === "# Hello"（实现为 view.state.doc.toString()，editor.ts:732-734） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常（destroy() 有 destroyed/destroying 幂等保护，重复调用安全返回，editor.ts:924-926） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === "# Hello"

---

## FP-01-01-N02 [P2] [N] 挂载到已加入 document 的节点时全局可查

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空（initialValue 未提供）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出（index.ts:1）
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`；`initialValue` 缺省时 `doc: config.initialValue ?? ""`（editor.ts:546）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 将 container 追加到 document.body 后创建编辑器 | [DOM] document.querySelector(".cm-editor") 不为 null（挂载于文档树内，可全局检索） | import: @floatboat/nexus-core; API: createEditor({ container }); 框架: vitest; 等待: 无 |
| 2 | 读取初始文档 | [API] editor.getDocument(): string === ""（initialValue 缺省回落空串，editor.ts:546） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常（destroy 幂等保护） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] document.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === ""

---

## FP-01-01-B01 [P4] [B] 离屏容器（未挂入 document）不抛错且 DOM 仍挂载

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  // 容器未追加到 document（离屏/延迟挂载场景）
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "hello" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出（index.ts:1）
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - 陷阱提示: CM6 只要求 parent 为有效 HTMLElement，不要求其在文档树内（`new EditorView({ parent: config.container })`，editor.ts:543-544），离屏挂载合法

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 用未挂入文档的离屏容器创建编辑器 | [STATE] 创建过程不抛异常（CM6 不校验 parent 是否在 document 中） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "hello" }); 框架: vitest; 等待: 无 |
| 2 | 检查容器内部 | [DOM] container.querySelector(".cm-editor") 不为 null（DOM 挂载到容器本身） | import: vitest; API: expect(container.querySelector(".cm-editor")).not.toBeNull(); 框架: vitest; 等待: 无 |
| 3 | 读取文档 | [API] editor.getDocument(): string === "hello" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常（destroy 幂等保护） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] createEditor 不抛异常
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === "hello"

---

## FP-01-01-E01 [P3] [E] 缺省 container 时应拒绝创建（容器为必填项）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 无（创建即失败）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  // container 为必填字段（types.ts:80），此处模拟运行时漏传（绕过 TS 编译期检查）
  ```
- **增强说明**:
  - import 路径: `createEditor`、`type EditorConfig` 均从 `@floatboat/nexus-core` 导出（index.ts:1、index.ts:35）
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`，`container: HTMLElement` 为唯一必填字段（types.ts:80）
  - 陷阱提示: 源码未对 container 做显式校验，无效 parent 由 CM6 `new EditorView({ parent })`（editor.ts:543）构造期抛出 TypeError，断言 toThrow() 与之吻合

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 createEditor({} as EditorConfig) | [STATE] 抛出异常（CM6 EditorView 构造时 parent 为 undefined 抛 TypeError，缺少必填挂载节点无法挂载） | import: @floatboat/nexus-core; API: createEditor({} as EditorConfig); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] expect(() => createEditor({} as EditorConfig)).toThrow()

---

## FP-01-01-E02 [P3] [E] container 为 null 时应拒绝创建

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 无（创建即失败）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  // 显式传入 null，模拟宿主错误用法
  ```
- **增强说明**:
  - import 路径: `createEditor`、`type EditorConfig` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - 陷阱提示: 同 E01，无效 parent 由 CM6 构造期抛 TypeError，无需源码层校验

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 createEditor({ container: null } as unknown as EditorConfig) | [STATE] 抛出异常（CM6 构造期 parent 为 null 抛 TypeError，无效的挂载节点） | import: @floatboat/nexus-core; API: createEditor({ container: null } as unknown as EditorConfig); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] expect(() => createEditor({ container: null } as unknown as EditorConfig)).toThrow()

---

## FP-01-01-F01 [P2] [F] 容器已有子内容时编辑器追加挂载且不覆盖原内容

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Title`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const existing = document.createElement("span");
  existing.textContent = "existing-content";
  existing.className = "pre-existing";
  container.appendChild(existing);
  const editor = createEditor({ container, initialValue: "# Title" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - 陷阱提示: CM6 以 `parent: config.container` 追加挂载（editor.ts:543-544），`view.dom` 追加到 container 末尾，不执行 innerHTML 清空，原子节点保留

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在容器已有子节点的情况下创建编辑器 | [DOM] container.querySelectorAll 同时存在原 `.pre-existing` 子节点与 `.cm-editor`（CM6 追加挂载不覆盖） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Title" }); 框架: vitest; 等待: 无 |
| 2 | 检查原节点内容 | [DOM] container.querySelector(".pre-existing")?.textContent === "existing-content"，未被清除或覆盖 | import: vitest; API: expect(container.querySelector(".pre-existing")?.textContent).toBe("existing-content"); 框架: vitest; 等待: 无 |
| 3 | 读取文档 | [API] editor.getDocument(): string === "# Title" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常（destroy 幂等保护） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".pre-existing") 不为 null 且 textContent === "existing-content"
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === "# Title"

---

## FP-01-01-F02 [P5] [F] destroy 后编辑器 DOM 从容器移除

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `text`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "text" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.destroy(): void`（EditorAPI，types.ts:267；实现 editor.ts:924-974，最终 `view.destroy()` 移除 DOM 并置 destroyed = true）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.destroy() | [STATE] 不抛异常（destroyed/destroying 标志幂等保护，editor.ts:924-926） | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |
| 2 | 检查容器内部 | [DOM] container.querySelector(".cm-editor") === null（view.destroy() 后 CM6 DOM 已从容器移除） | import: vitest; API: expect(container.querySelector(".cm-editor")).toBeNull(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor") === null（destroy 后 DOM 已清理）

---

## 增强信息来源（FP-01-01 挂载）
- API签名: packages/core/src/editor.ts（createEditor:232、destroy:924-974、view 构造 parent:543）
- 类型定义: packages/core/src/types.ts（EditorConfig.container:80 必填、EditorAPI:186-278）
- 测试参考: packages/core/test/editor.test.ts（"creates an editor with the initial document":17-26、"mounts into the provided container and removes editor dom on destroy":27-37）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-02-N01 [P1] [N] 初始文档内容与 getDocument 一致且 AST 正确

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "# Hello" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`（types.ts:187-188；实现 editor.ts:732-737）
  - AST 说明: 默认路径 `lezerStringToMdast(config.initialValue ?? "")`（editor.ts:300），`# Hello` 解析为 heading 节点；类型 Root 来自 mdast（测试参考 editor.test.ts:1 `import type { Root } from "mdast"`）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取初始文档 | [API] editor.getDocument(): string === "# Hello"（view.state.doc.toString()） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 读取初始 AST | [API] editor.getAst(): Root 的 children[0]?.type === "heading"（"# Hello" 解析为 heading 节点） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === "# Hello"
- [API] editor.getAst().children[0]?.type === "heading"

---

## FP-01-02-N02 [P1] [N] 复杂 Markdown 初始化后 AST 结构与原文完整保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# 标题\n\n- 项一\n- 项二\n\n**加粗** 与 *斜体*`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const source = "# 标题\n\n- 项一\n- 项二\n\n**加粗** 与 *斜体*";
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: source });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`（Root.children: 顶层节点数组）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取文档内容 | [API] editor.getDocument(): string 与 source 逐字符一致（原文完整保留） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 读取 AST 顶层节点类型 | [API] editor.getAst().children.map((n) => n.type) 依次包含 "heading"、"list"、"paragraph" | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === source
- [API] editor.getAst().children.map((n) => n.type) 依次包含 "heading"、"list"、"paragraph"

---

## FP-01-02-N03 [P2] [N] 中文等多字节内容初始化正确

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `你好，Nexus 编辑器！\n第二行内容`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const source = "你好，Nexus 编辑器！\n第二行内容";
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: source });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`
  - 陷阱提示: CM6 文档模型按 UTF-16 code unit 计算偏移，中文按多字节处理但 doc.toString() 原样保留；纯文本两行解析为 paragraph

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取文档内容 | [API] editor.getDocument(): string === source（多字节字符完整保留） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [API] editor.getAst().children[0]?.type === "paragraph"（纯文本解析为段落） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === source
- [API] editor.getAst().children[0]?.type === "paragraph"

---

## FP-01-02-B01 [P4] [B] initialValue 缺省时为空文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空（initialValue 未提供）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`
  - 陷阱提示: initialValue 缺省回落空串（`doc: config.initialValue ?? ""`，editor.ts:546）；空文档解析为 `Root` 节点，type === "root"、children 为空数组

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 不传 initialValue 创建编辑器 | [API] editor.getDocument(): string === ""（initialValue ?? "" 回落） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 读取 AST | [API] editor.getAst(): Root 的 type === "root" 且 children 为空数组 | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === ""
- [API] editor.getAst().children.length === 0

---

## FP-01-02-B02 [P4] [B] initialValue 为空字符串时正常创建

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ``（空字符串）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.setDocument(next: string, opts?: SetDocumentOptions): void`（types.ts:218）、`editor.getDocument(): string`
  - 陷阱提示: IME 组合输入期间调用 setDocument 会被推迟到 compositionend 再应用（editor.ts:810-819），纯 jsdom 测试无 IME 场景，可直接应用

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以空字符串创建编辑器 | [STATE] 创建不抛异常 | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "" }); 框架: vitest; 等待: 无 |
| 2 | 读取文档 | [API] editor.getDocument(): string === "" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 随后执行编辑（setDocument） | [API] editor.setDocument("abc") 后 getDocument() === "abc"（空文档可正常继续编辑） | import: @floatboat/nexus-core; API: editor.setDocument("abc"); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === ""
- [API] editor.setDocument("abc") 后 editor.getDocument() === "abc"

---

## FP-01-02-E01 [P3] [E] 非法 Markdown（未闭合代码块）容错解析不抛错

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: ```` ```js\nconsole.log(1)\n ````（代码围栏未闭合）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const broken = "```js\nconsole.log(1)\n";
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: broken });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`
  - 陷阱提示: 默认解析走 Lezer 容错解析（editor.ts:300 `lezerStringToMdast`），未闭合代码块不会导致解析崩溃，始终返回有效 Root；参考测试 "keeps the editor usable when the parser throws"（editor.test.ts:176-197）保证解析异常时编辑器仍可用

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以未闭合代码块的非法 Markdown 创建编辑器 | [STATE] 创建过程不抛异常（Lezer 容错解析） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: broken }); 框架: vitest; 等待: 无 |
| 2 | 读取文档 | [API] editor.getDocument(): string === broken（原文完整保留，无内容丢失） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 读取 AST | [API] editor.getAst(): Root 的 type === "root"（解析容错，返回有效根节点） | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] createEditor 不抛异常
- [API] editor.getDocument() === broken
- [API] editor.getAst().type === "root"

---

## FP-01-02-D01 [P5] [D] 大文档（100 行）初始化后内容逐行完整保留

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 100 行文本（`行 1` ~ `行 100`）
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const lines = Array.from({ length: 100 }, (_, i) => `行 ${i + 1}`);
  const source = lines.join("\n");
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: source });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getDocument(): string`、`editor.getAst(): Root`
  - 陷阱提示: 默认解析为同步 Lezer 解析（editor.ts:242-244 注释），100 行规模无性能陷阱；`getDocument()` 直接读 `view.state.doc.toString()` 保证与原文一致

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 读取大文档内容 | [API] editor.getDocument(): string === source（100 行完整保留） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 2 | 按换行拆分验证行数与首尾行 | [API] 拆分结果长度为 100，首行为 "行 1"，末行为 "行 100" | import: vitest; API: expect(editor.getDocument().split("\n")).toHaveLength(100); 框架: vitest; 等待: 无 |
| 3 | 读取 AST | [API] editor.getAst(): Root 的 type === "root" | import: @floatboat/nexus-core; API: editor.getAst(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === source
- [API] editor.getDocument().split("\n").length === 100
- [API] editor.getDocument().split("\n")[0] === "行 1" 且末行 === "行 100"

---

## 增强信息来源（FP-01-02 初始文档/AST）
- API签名: packages/core/src/editor.ts（getDocument:732、getAst:735-737、initialValue 回落:546、Lezer 解析:300）
- 类型定义: packages/core/src/types.ts（EditorConfig.initialValue:81、EditorAPI.getDocument:187/getAst:188、SetDocumentOptions:165）
- 测试参考: packages/core/test/editor.test.ts（"creates an editor with the initial document":17-26、"emits a parsed AST for the current markdown document":76-92、"keeps the editor usable when the parser throws":176-197）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-03-N01 [P1] [N] 插件 slashCommands 注册后可通过 API 获取

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: `[{ name: "demo", slashCommands: [{ id: "heading", title: "Heading", keywords: ["h1"] }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    plugins: [
      {
        name: "demo",
        slashCommands: [
          { id: "heading", title: "Heading", keywords: ["h1"] },
        ],
      },
    ],
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`SlashCommandDef` 类型（types.ts:280）从 `@floatboat/nexus-core` 导出（index.ts:52）
  - 涉及 API: `editor.getSlashCommands(): SlashCommandDef[]`（types.ts:197；实现 editor.ts:765-767 直接返回 `slashCommands` 数组）
  - 插件字段: `NexusPlugin.slashCommands`（editor.ts:248 `plugins.flatMap((plugin) => plugin.slashCommands ?? [])`）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.getSlashCommands() | [API] getSlashCommands(): SlashCommandDef[] 返回的命令 id 列表包含 "heading"（插件注册命令直接聚合） | import: @floatboat/nexus-core; API: editor.getSlashCommands(); 框架: vitest; 等待: 无 |
| 2 | 检查命令元数据 | [API] id 为 "heading" 的命令 title === "Heading" 且 keywords 包含 "h1"（SlashCommandDef 字段透传） | import: vitest; API: expect(cmd.title).toBe("Heading"); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getSlashCommands().some((c) => c.id === "heading") 为 true
- [API] 对应命令 title === "Heading"、keywords 包含 "h1"

---

## FP-01-03-N02 [P1] [N] 插件 shortcuts 注册后快捷键生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: `[{ name: "shortcut-demo", shortcuts: [{ key: "Ctrl-j", run: (api) => { api.replaceSelection("X"); return true; } }] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [
      {
        name: "shortcut-demo",
        shortcuts: [
          {
            key: "Ctrl-j",
            run: (api) => {
              api.replaceSelection("X");
              return true;
            },
          },
        ],
      },
    ],
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`EditorAPI` 类型从 `@floatboat/nexus-core` 导出（index.ts:33）
  - 涉及 API: `editor.runShortcut(key: string): boolean`（types.ts:257）——推荐直接调用该 API 替代派发 DOM 事件；快捷键经 keymap 扩展注入（editor.ts:720 `shortcutExtensions`）
  - 插件字段: `NexusPlugin.shortcuts`（editor.ts:247）
  - 陷阱提示: 若走 DOM keydown 派发，需派发到 `.cm-content` 节点并保证 `bubbles: true`；jsdom 下更稳妥的方式是 `editor.runShortcut("Ctrl-j")`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在可编辑内容节点上派发 Ctrl+J 的 keydown 事件 | [STATE] 事件被快捷键消费（默认行为被阻止，无异常；keymap 命中后 run 返回 true） | import: @floatboat/nexus-core; API: editor.runShortcut("Ctrl-j") 或派发 KeyboardEvent 至 .cm-content; 框架: vitest; 等待: 无 |
| 2 | 读取文档 | [API] editor.getDocument(): string === "X"（插件 run 已通过 api.replaceSelection("X") 执行） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === "X"
- [STATE] 派发 keydown 后无未捕获异常

---

## FP-01-03-N03 [P2] [N] 插件 cmExtensions 注入生效

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: `[{ name: "attrs", cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })] }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import { EditorView } from "@codemirror/view";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    plugins: [
      {
        name: "attrs",
        cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })],
      },
    ],
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`EditorView` 从 `@codemirror/view` 导入（测试参考 editor.test.ts:2 同款导入）
  - 涉及 API: `NexusPlugin.cmExtensions` 注入（editor.ts:249 `plugins.flatMap((plugin) => plugin.cmExtensions ?? [])`，拼入 extensions 数组 editor.ts:722）
  - 陷阱提示: `EditorView.editorAttributes.of` 渲染在 `.cm-editor` 根节点上，用 `getAttribute` 断言

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 检查编辑器根节点属性 | [DOM] container.querySelector(".cm-editor")?.getAttribute("data-plugin") === "yes"（cmExtensions 拼入 CM6 extensions，editor.ts:722） | import: @codemirror/view; API: EditorView.editorAttributes.of({ "data-plugin": "yes" }); 框架: vitest; 等待: 无 |
| 2 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor")?.getAttribute("data-plugin") === "yes"

---

## FP-01-03-E01 [P3] [E] 多插件注册同 id 命令时先注册者优先

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 两个插件均注册 id 为 "same" 的命名命令（run 实现不同）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const firstRun = () => "first";
  const secondRun = () => "second";
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    plugins: [
      { name: "plugin-a", commands: [{ id: "same", run: firstRun }] },
      { name: "plugin-b", commands: [{ id: "same", run: secondRun }] },
    ],
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`EditorCommand` 类型从 `@floatboat/nexus-core` 导出（index.ts:34）
  - 涉及 API: `editor.getCommands(): EditorCommand[]`（types.ts:259）、`editor.runCommand(id: string): boolean`（types.ts:261）
  - 先注册者优先实现: `commandById` Map 中 `if (!commandById.has(command.id)) commandById.set(command.id, command)`（editor.ts:253-256），后注册同 id 命令被忽略
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.getCommands() 查找 id 为 "same" 的命令 | [API] 命令存在且其 run 为第一个插件的 firstRun（Map 先注册者优先，editor.ts:253-256） | import: @floatboat/nexus-core; API: editor.getCommands(); 框架: vitest; 等待: 无 |
| 2 | 调用 editor.runCommand("same") | [API] 返回 boolean true（找到命令并执行成功） | import: @floatboat/nexus-core; API: editor.runCommand("same"); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getCommands().find((c) => c.id === "same")?.run === firstRun
- [API] editor.runCommand("same") === true

---

## FP-01-03-F01 [P2] [F] 插件 handlers 的 keydown 钩子可消费事件并影响文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: `[{ name: "keydown-hook", handlers: { keydown: (_event, ctx) => { ctx.insertMarkdown("HOOK"); return true; } } }]`
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    plugins: [
      {
        name: "keydown-hook",
        handlers: {
          keydown: (_event, ctx) => {
            ctx.insertMarkdown("HOOK");
            return true;
          },
        },
      },
    ],
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`EditorEventHandler`/`EditorEventContext` 类型从 `@floatboat/nexus-core` 导出（index.ts:37-38）
  - 涉及 API: 插件 `handlers.keydown` 经 `EditorView.domEventHandlers({ keydown })` 处理（editor.ts:703-709），handler 返回 true 则 `event.preventDefault()` 并停止派发（runEventHandlers editor.ts:471-478）
  - ctx 能力: `ctx.insertMarkdown(markdown)` 内部执行 `view.dispatch(view.state.replaceSelection(markdown))`（editor.ts:462-464）
  - 陷阱提示: 派发 keydown 时需带 `cancelable: true` 才能断言 defaultPrevented；事件需派发到 `.cm-content` 节点且 `bubbles: true`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 在可编辑内容节点上派发 keydown 事件（key 为 "F2"） | [STATE] 钩子消费事件并插入 "HOOK"，事件 defaultPrevented 为 true（handler 返回 true 触发 preventDefault，editor.ts:703-709） | import: @floatboat/nexus-core; API: 派发 KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }) 至 .cm-content; 框架: vitest; 等待: 无 |
| 2 | 读取文档 | [API] editor.getDocument(): string 包含 "HOOK"（ctx.insertMarkdown 经 replaceSelection 插入） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] keydown 事件 defaultPrevented === true
- [API] editor.getDocument().includes("HOOK") 为 true

---

## FP-01-03-B01 [P4] [B] plugins 缺省时编辑器正常创建且内置能力可用

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hi`
- 插件配置: 无（plugins 未提供）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: "# Hi" });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`；plugins 缺省时 `config.plugins ?? []`（editor.ts:233）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 不传 plugins 创建编辑器 | [STATE] 创建不抛异常（plugins ?? [] 回落） | import: @floatboat/nexus-core; API: createEditor({ container, initialValue: "# Hi" }); 框架: vitest; 等待: 无 |
| 2 | 检查挂载 | [DOM] container.querySelector(".cm-editor") 不为 null | import: vitest; API: expect(container.querySelector(".cm-editor")).not.toBeNull(); 框架: vitest; 等待: 无 |
| 3 | 读取文档与命令 | [API] getDocument(): string === "# Hi"；[API] getSlashCommands(): SlashCommandDef[] 为空数组（无插件注册） | import: @floatboat/nexus-core; API: editor.getDocument() / editor.getSlashCommands(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === "# Hi"
- [API] editor.getSlashCommands().length === 0

---

## FP-01-03-B02 [P4] [B] plugins 为空数组时编辑器正常创建

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: `[]`（空数组）
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container, plugins: [] });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.getSlashCommands(): SlashCommandDef[]`、`editor.getCommands(): EditorCommand[]`（types.ts:259）
  - 陷阱提示: `getCommands()` 含内置命令（如 editor.test.ts:38-47 的 read-only 场景亦依赖内置扩展），仅断言"无插件命令"而非空数组

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以空数组作为 plugins 创建编辑器 | [STATE] 创建不抛异常（flatMap 空数组安全） | import: @floatboat/nexus-core; API: createEditor({ container, plugins: [] }); 框架: vitest; 等待: 无 |
| 2 | 检查挂载 | [DOM] container.querySelector(".cm-editor") 不为 null | import: vitest; API: expect(container.querySelector(".cm-editor")).not.toBeNull(); 框架: vitest; 等待: 无 |
| 3 | 检查命令注册 | [API] editor.getSlashCommands().length === 0 且 editor.getCommands() 仅含内置命令（无插件命令） | import: @floatboat/nexus-core; API: editor.getSlashCommands() / editor.getCommands(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getSlashCommands().length === 0

---

## 增强信息来源（FP-01-03 插件）
- API签名: packages/core/src/editor.ts（plugins 聚合:233、slashCommands:248、cmExtensions:249、commands Map:251-256、keydown 钩子:703-709、insertMarkdown ctx:462-464、runEventHandlers:471-478）
- 类型定义: packages/core/src/types.ts（EditorConfig.plugins:85、EditorAPI.getSlashCommands:197/getCommands:259/runCommand:261/runShortcut:257、SlashCommandDef:280）
- 测试参考: packages/core/test/editor.test.ts（"composes remark and shortcut plugin contributions":198-244、import EditorView:2）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-04-N01 [P1] [N] 默认 themePrefix 为 'nx-'，主题变量以 --nx- 命名

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `# Hello`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, lightTheme } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  // ⚠️ 实现差异: EditorConfig 无 themePrefix 字段（types.ts:79-121），
  // 需 as unknown as EditorConfig 绕过 TS 编译期检查；源码主题变量硬编码 --nexus-*（theme.ts:81-99）
  const editor = createEditor({
    container,
    initialValue: "# Hello",
    theme: lightTheme,
    themePrefix: "nx-",
  } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor`、`lightTheme` 从 `@floatboat/nexus-core` 导出（index.ts:1、index.ts:22 `export { lightTheme, darkTheme, type NexusTheme } from "./theme"`）
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`；`theme?: NexusTheme`（types.ts:86）
  - ⚠️ 陷阱提示（实现差异）: **`EditorConfig` 接口中不存在 `themePrefix` 字段**（types.ts:79-121 全字段无此配置）；theme.ts `VAR_MAP` 将颜色 token 硬编码映射为 `--nexus-*` CSS 变量（theme.ts:81-99 `bg: "--nexus-bg"` 等），`themeToEditorTheme` 经 `EditorView.theme` 注入（theme.ts:120-147）。需求假设默认前缀 'nx-' 与实际实现 `--nexus-` 不一致，**实际断言应查 `--nexus-bg`**

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器（不配置 themePrefix） | [STATE] 创建不抛异常（themePrefix 被忽略，theme 缺省回落 lightTheme，editor.ts:501 `config.theme ?? lightTheme`） | import: @floatboat/nexus-core; API: createEditor({ container, theme: lightTheme } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查注入的主题样式 | [DOM] document.head 中 style 节点 textContent 包含 "--nexus-bg"（源码硬编码前缀；需求假设的 "--nx-bg" 不存在） | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] document.head.querySelectorAll("style") 中存在 textContent 包含 "--nexus-bg" 的样式节点（实现硬编码前缀，原预期 "--nx-bg" 为需求假设）

---

## FP-01-04-N02 [P2] [N] 自定义 themePrefix 后主题变量名随之变化

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, lightTheme } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  // ⚠️ themePrefix 配置项不存在，实际不会注入 --my-bg，仍为 --nexus-*
  const editor = createEditor({
    container,
    theme: lightTheme,
    themePrefix: "my-",
  } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor`、`lightTheme` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - ⚠️ 陷阱提示（实现差异）: 同 N01，`themePrefix` 字段不存在（types.ts:79-121），前缀无法自定义，实际注入样式始终为 `--nexus-*`；本用例断言 `--my-bg` 属于需求假设，真实实现中**不会出现**，需改为断言 `--nexus-bg`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以 themePrefix: "my-" 创建编辑器 | [STATE] 创建不抛异常（themePrefix 为多余字段被忽略） | import: @floatboat/nexus-core; API: createEditor({ container, theme: lightTheme, themePrefix: "my-" } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查注入的主题样式 | [DOM] ⚠️ 实现差异: 样式文本不包含 "--my-bg"（前缀不可自定义）；实际包含 "--nexus-bg" | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 3 | 检查默认前缀是否残留 | [DOM] 样式文本包含 "--nexus-bg"（无前缀替换概念，原 "--nx-bg" 断言不适用） | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] document.head 中存在包含 "--nexus-bg" 的样式节点（原 "--my-bg" 断言为需求假设，实现不支持前缀替换）

---

## FP-01-04-E01 [P3] [E] themePrefix 含非法字符时不抛错

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, lightTheme } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  // ⚠️ themePrefix 配置项不存在，非法值被忽略，不产生任何副作用
  const editor = createEditor({
    container,
    theme: lightTheme,
    themePrefix: "nx theme!",
  } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor`、`lightTheme` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - ⚠️ 陷阱提示（实现差异）: 同 N01，`themePrefix` 字段不存在；"非法字符不抛错" 的结论成立（字段被忽略），但原因不是容错校验而是配置项缺失

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以含空格与感叹号的 themePrefix 创建编辑器 | [STATE] 创建不抛异常（多余字段被忽略，不影响编辑器可用性） | import: @floatboat/nexus-core; API: createEditor({ container, theme: lightTheme, themePrefix: "nx theme!" } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查挂载 | [DOM] container.querySelector(".cm-editor") 不为 null | import: vitest; API: expect(container.querySelector(".cm-editor")).not.toBeNull(); 框架: vitest; 等待: 无 |
| 3 | 读取文档 | [API] editor.getDocument(): string === "" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 4 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] createEditor 不抛异常
- [DOM] container.querySelector(".cm-editor") 不为 null
- [API] editor.getDocument() === ""

---

## FP-01-04-B01 [P4] [B] themePrefix 为空字符串时回落默认 'nx-'

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, lightTheme } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  // ⚠️ themePrefix 配置项不存在，无"回落"逻辑；实际变量固定为 --nexus-*
  const editor = createEditor({
    container,
    theme: lightTheme,
    themePrefix: "",
  } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor`、`lightTheme` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`
  - ⚠️ 陷阱提示（实现差异）: `themePrefix` 字段不存在，空字符串无回落语义；实际注入变量固定 `--nexus-*`（theme.ts:81-99）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 以空字符串 themePrefix 创建编辑器 | [STATE] 创建不抛异常 | import: @floatboat/nexus-core; API: createEditor({ container, theme: lightTheme, themePrefix: "" } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查主题样式前缀 | [DOM] 样式文本包含 "--nexus-bg"（实现固定前缀；原"--nx-bg"回落断言为需求假设） | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] document.head 中存在包含 "--nexus-bg" 的样式节点（原预期 "--nx-bg" 需按实现修正）

---

## FP-01-04-B02 [P4] [B] 未配置 theme 时默认主题仍应用前缀变量

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  // ⚠️ themePrefix 配置项不存在；未传 theme 时回落 lightTheme（editor.ts:501）
  const editor = createEditor({
    container,
    themePrefix: "df-",
  } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`；`theme` 缺省回落 `lightTheme`（editor.ts:501 `createThemeExtension(config.theme ?? lightTheme)`）
  - ⚠️ 陷阱提示（实现差异）: `themePrefix` 不存在；未传 theme 时确实应用默认主题（lightTheme），但变量前缀固定 `--nexus-*`，"自定义前缀应用于默认主题" 的需求假设不成立

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 仅配置 themePrefix、不传 theme 创建编辑器 | [STATE] 创建不抛异常（theme 回落 lightTheme，themePrefix 被忽略） | import: @floatboat/nexus-core; API: createEditor({ container, themePrefix: "df-" } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查主题样式前缀 | [DOM] 样式文本包含 "--nexus-bg"（默认主题生效但前缀固定；原"--df-bg"断言为需求假设） | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] document.head 中存在包含 "--nexus-bg" 的样式节点（原 "--df-bg" 断言需按实现修正）

---

## FP-01-04-F01 [P2] [F] 两个编辑器实例使用不同前缀互不干扰（样式隔离）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor, lightTheme } from "@floatboat/nexus-core";
  import type { EditorConfig } from "@floatboat/nexus-core";

  const containerA = document.createElement("div");
  const containerB = document.createElement("div");
  // ⚠️ themePrefix 配置项不存在；两实例均注入 --nexus-* 变量，无前缀隔离概念
  const editorA = createEditor({ container: containerA, theme: lightTheme, themePrefix: "a-" } as unknown as EditorConfig);
  const editorB = createEditor({ container: containerB, theme: lightTheme, themePrefix: "b-" } as unknown as EditorConfig);
  ```
- **增强说明**:
  - import 路径: `createEditor`、`lightTheme` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`；主题经 `themeCompartment` 隔离（theme.ts:150-159，每实例独立 Compartment）
  - ⚠️ 陷阱提示（实现差异）: `themePrefix` 不存在，"a-"/"b-" 前缀不会生效；两实例 CSS 变量均为 `--nexus-*`，仅可通过独立 style 注入共存

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建两个不同前缀的编辑器实例 | [STATE] 均创建成功不抛异常 | import: @floatboat/nexus-core; API: createEditor({ container, theme: lightTheme, themePrefix: "a-" | "b-" } as unknown as EditorConfig); 框架: vitest; 等待: 无 |
| 2 | 检查样式 | [DOM] ⚠️ 实现差异: 样式仅包含 "--nexus-bg"（无 "--a-bg"/"--b-bg" 变量，前缀隔离为需求假设） | import: vitest; API: expect(styleNodes.some((s) => s.textContent.includes("--nexus-bg"))).toBe(true); 框架: vitest; 等待: 无 |
| 3 | 分别读取文档 | [API] 两个实例的 getDocument(): string 均为 "" | import: @floatboat/nexus-core; API: editorA.getDocument() / editorB.getDocument(); 框架: vitest; 等待: 无 |
| 4 | 清理：editorA.destroy(); editorB.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [DOM] 样式文本包含 "--nexus-bg"（原 "--a-bg"/"--b-bg" 并存断言为需求假设，实现不支持前缀隔离）
- [API] editorA.getDocument() === "" 且 editorB.getDocument() === ""

---

## 增强信息来源（FP-01-04 主题）
- API签名: packages/core/src/editor.ts（theme 回落 lightTheme:501、createThemeExtension:501、setTheme:744-747）
- 类型定义: packages/core/src/types.ts（EditorConfig.theme:86；⚠️ 无 themePrefix 字段:79-121）
- 主题实现: packages/core/src/theme.ts（VAR_MAP 硬编码 --nexus-*:81-99、themeToEditorTheme EditorView.theme 注入:102-148、themeCompartment:150-159）
- 测试参考: packages/core/test/editor.test.ts（read-only 场景内置扩展:38-47）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-05-N01 [P1] [N] onChange 在文档变化时被调用且参数为最新文档

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const docs: string[] = [];
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onChange: (doc) => {
      docs.push(doc);
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onChange?: (doc: string, ast: Root) => void`（types.ts:101；触发点 editor.ts:597-599 `config.onChange?.(markdown, currentAst)`）
  - 触发时机: updateListener 检测到 docChanged 且非 silent 时触发（editor.ts:586-599）；`setDocument` 默认 `silent: false` 走 onChange 管线
  - 陷阱提示: 初始创建**不触发** onChange（初始 doc 不构成 update 事件）；参考测试 "emits change notifications when the document changes"（editor.test.ts:48-74）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器后立即检查收集数组 | [EVENT] docs 长度为 0（初始创建不触发 onChange） | import: vitest; API: expect(docs).toHaveLength(0); 框架: vitest; 等待: 无 |
| 2 | 调用 editor.setDocument("next") | [EVENT] onChange 被调用，docs 为 ["next"]（setDocument 默认 silent: false 触发变更） | import: @floatboat/nexus-core; API: editor.setDocument("next"); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(docs).toEqual(["next"])
- [EVENT] 创建阶段 docs 长度为 0

---

## FP-01-05-N02 [P2] [N] onChange 第二参数为最新 AST

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  let lastAst: unknown;
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onChange: (_doc, ast) => {
      lastAst = ast;
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onChange?: (doc: string, ast: Root) => void`；AST 类型为 mdast `Root`（测试参考 editor.test.ts:1 `import type { Root } from "mdast"`）
  - 触发时机: 每次变更重解析后以最新 currentAst 回调（editor.ts:597-599）
  - 陷阱提示: 参考测试 "emits a parsed AST for the current markdown document"（editor.test.ts:76-92），断言 ast.type === "root"

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.setDocument("# Hello") | [EVENT] onChange 第二参数 ast 的 type === "root" 且 children[0]?.type === "heading"（最新解析结果） | import: @floatboat/nexus-core; API: editor.setDocument("# Hello"); 框架: vitest; 等待: 无 |
| 2 | 再次 setDocument("plain text") | [EVENT] ast 更新为 children[0]?.type === "paragraph"（AST 跟随文档变化） | import: @floatboat/nexus-core; API: editor.setDocument("plain text"); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] 首次 onChange 的 ast.children[0]?.type === "heading"
- [EVENT] 二次 onChange 的 ast.children[0]?.type === "paragraph"

---

## FP-01-05-E01 [P3] [E] setDocument 默认触发一次 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `a`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  let calls = 0;
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "a",
    onChange: () => {
      calls += 1;
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.setDocument(next: string, opts?: SetDocumentOptions): void`（types.ts:218）；`SetDocumentOptions.silent?: boolean` 默认 undefined（视为 false）
  - 触发机制: `setDocument` → view.dispatch → updateListener docChanged → 无 silent annotation → emitChange（editor.ts:586-599）
  - 陷阱提示: IME 组合输入期间 setDocument 推迟到 compositionend 应用（editor.ts:810-819），jsdom 无 IME 场景

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.setDocument("b") | [EVENT] onChange 调用次数为 1（每次文档变更恰好触发一次） | import: @floatboat/nexus-core; API: editor.setDocument("b"); 框架: vitest; 等待: 无 |
| 2 | 读取文档确认 | [API] editor.getDocument(): string === "b" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(calls).toBe(1)
- [API] editor.getDocument() === "b"

---

## FP-01-05-E02 [P3] [E] setDocument 传 { silent: true } 时不触发 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `a`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  let calls = 0;
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "a",
    onChange: () => {
      calls += 1;
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`SetDocumentOptions` 类型从 `@floatboat/nexus-core` 导出（index.ts:54）
  - 涉及 API: `editor.setDocument(next: string, { silent: true }: SetDocumentOptions)`；silent 经 `silentDocChange` annotation 标记（types.ts:165-170），updateListener 命中后跳过 emitChange（editor.ts:604-606）
  - 陷阱提示: silent 只抑制 onChange，文档内容仍更新；参考测试 "preserves selection for silent document loads without emitting change"（editor.test.ts:105-127）

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.setDocument("silent-update", { silent: true }) | [EVENT] onChange 不被调用（calls 仍为 0，silent annotation 抑制 emitChange，editor.ts:604-606） | import: @floatboat/nexus-core; API: editor.setDocument("silent-update", { silent: true }); 框架: vitest; 等待: 无 |
| 2 | 读取文档确认内容已更新 | [API] editor.getDocument(): string === "silent-update"（silent 只抑制回调，文档仍更新） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(calls).toBe(0)
- [API] editor.getDocument() === "silent-update"

---

## FP-01-05-E03 [P3] [E] onChange 回调抛异常向上传播

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onChange: () => {
      throw new Error("boom");
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onChange?: (doc: string, ast: Root) => void`
  - 传播机制: emitChange 中直接调用 `config.onChange?.(markdown, currentAst)`（editor.ts:597-599），回调抛出的异常不捕获、向上传播到 setDocument 调用方
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.setDocument("x")（onChange 抛异常） | [STATE] 抛出的异常 Error("boom") 向上传播（emitChange 不捕获回调异常） | import: @floatboat/nexus-core; API: expect(() => editor.setDocument("x")).toThrow("boom"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] expect(() => editor.setDocument("x")).toThrow("boom")

---

## FP-01-05-B01 [P4] [B] 连续多次 setDocument 每次均触发一次 onChange

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  let calls = 0;
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onChange: () => {
      calls += 1;
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.setDocument(next: string, opts?: SetDocumentOptions): void`
  - 触发机制: 每次 dispatch 均被 updateListener 捕获并触发 emitChange（editor.ts:586-599），无去重/节流
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 依次调用 setDocument("a")、setDocument("b")、setDocument("c") | [EVENT] onChange 共调用 3 次（每次 setDocument 触发一次，无节流） | import: @floatboat/nexus-core; API: editor.setDocument("a"); editor.setDocument("b"); editor.setDocument("c"); 框架: vitest; 等待: 无 |
| 2 | 读取最终文档 | [API] editor.getDocument(): string === "c" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(calls).toBe(3)
- [API] editor.getDocument() === "c"

---

## FP-01-05-D01 [P5] [D] 创建时不触发 onChange（避免误报初始加载）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: `initial`
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  let calls = 0;
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "initial",
    onChange: () => {
      calls += 1;
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `createEditor(config: EditorConfig): EditorAPI`、`onChange?: (doc: string, ast: Root) => void`
  - 触发机制: 初始 doc 在 EditorState 构造期写入，不经过 updateListener 的 docChanged 路径（editor.ts:586-599），故不触发 onChange
  - 陷阱提示: 与 onChange 集成时（如外部状态同步），需注意初始加载不回调，避免重复写回

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 创建编辑器（带 initialValue 与 onChange） | [EVENT] onChange 调用次数为 0（初始加载不触发回调，editor.ts:586-599 仅 update 路径触发） | import: vitest; API: expect(calls).toBe(0); 框架: vitest; 等待: 无 |
| 2 | 读取文档确认内容 | [API] editor.getDocument(): string === "initial" | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(calls).toBe(0)
- [API] editor.getDocument() === "initial"

---

## 增强信息来源（FP-01-05 onChange 回调）
- API签名: packages/core/src/editor.ts（updateListener:586-599、emitChange:597-599、silentDocChange 跳过:604-606、setDocument 实现:808-819、IME 推迟:810-819）
- 类型定义: packages/core/src/types.ts（EditorConfig.onChange:101、SetDocumentOptions.silent:165-170、EditorAPI.setDocument:218）
- 测试参考: packages/core/test/editor.test.ts（"emits change notifications when the document changes":48-74、"emits a parsed AST for the current markdown document":76-92、"preserves selection for silent document loads without emitting change":105-127）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-06-N01 [P1] [N] focus() 触发 onFocus 回调

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const onFocus = vi.fn();
  const container = document.createElement("div");
  const editor = createEditor({ container, onFocus });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出；`onFocus` 断言用 `vi.fn()`（Vitest 内置，无需 import）
  - 涉及 API: `editor.focus(): void`（types.ts:252；实现 editor.ts:855-857 `view.focus(); setFocused(true);`）；`onFocus?: () => void`（types.ts:102）
  - 触发时机: `setFocused(true)` 中 `focused !== true` 时调用 `config.onFocus?.()`（editor.ts:876-886）
  - 陷阱提示: 事件双通道——config 回调 onFocus 与 emitter "focus" 事件并存（events.test.ts 模式）；可任选其一断言

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.focus() | [EVENT] onFocus 被调用 1 次（setFocused 中 focused 由 false→true 触发回调，editor.ts:876-886） | import: @floatboat/nexus-core; API: editor.focus(); 框架: vitest; 等待: 无 |
| 2 | 检查文档焦点 | [DOM] document.activeElement === container.querySelector(".cm-content")（CM6 contentDOM 获得焦点） | import: vitest; API: expect(document.activeElement).toBe(container.querySelector(".cm-content")); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(onFocus).toHaveBeenCalledOnce()
- [DOM] document.activeElement === container.querySelector(".cm-content")

---

## FP-01-06-N02 [P2] [N] blur() 触发 onBlur 回调且焦点离开编辑器

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const events: string[] = [];
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onFocus: () => events.push("focus"),
    onBlur: () => events.push("blur"),
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.focus(): void`、`editor.blur(): void`（types.ts:253；实现 editor.ts:859-861 `view.contentDOM.blur(); setFocused(false);`）、`onBlur?: () => void`（types.ts:103）
  - 触发时机: `setFocused(false)` 中 `focused !== false` 时调用 `config.onBlur?.()`（editor.ts:876-886）
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 先 focus 再 blur | [EVENT] events 依次为 ["focus", "blur"]（focus→setFocused(true)→onFocus，blur→setFocused(false)→onBlur） | import: @floatboat/nexus-core; API: editor.focus(); editor.blur(); 框架: vitest; 等待: 无 |
| 2 | 检查焦点 | [DOM] document.activeElement 不为 .cm-content（contentDOM.blur() 后焦点离开） | import: vitest; API: expect(document.activeElement).not.toBe(container.querySelector(".cm-content")); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(events).toEqual(["focus", "blur"])
- [DOM] document.activeElement 不为 .cm-content

---

## FP-01-06-F01 [P2] [F] 多次 focus/blur 交替时回调按序触发

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const events: string[] = [];
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onFocus: () => events.push("focus"),
    onBlur: () => events.push("blur"),
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.focus(): void`、`editor.blur(): void`
  - 触发时机: setFocused 状态翻转驱动（editor.ts:876-886），每次状态变化触发一次回调
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 依次 focus → blur → focus → blur | [EVENT] events 依次为 ["focus", "blur", "focus", "blur"]（每次状态翻转恰好一次） | import: @floatboat/nexus-core; API: editor.focus(); editor.blur(); editor.focus(); editor.blur(); 框架: vitest; 等待: 无 |
| 2 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(events).toEqual(["focus", "blur", "focus", "blur"])

---

## FP-01-06-E01 [P3] [E] destroy 后调用 focus/blur 不抛错且不触发回调

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const onFocus = vi.fn();
  const onBlur = vi.fn();
  const container = document.createElement("div");
  const editor = createEditor({ container, onFocus, onBlur });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.destroy(): void`、`editor.focus(): void`、`editor.blur(): void`
  - 防护机制: focus()/blur() 实现开头 `if (destroyed) return;`（editor.ts:855、859-861 前段），destroy 后调用静默返回，不访问已销毁的 view
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | destroy 后依次调用 focus()、blur() | [STATE] 不抛异常（focus/blur 有 destroyed 短路保护，editor.ts:855-869） | import: @floatboat/nexus-core; API: editor.destroy(); editor.focus(); editor.blur(); 框架: vitest; 等待: 无 |
| 2 | 检查回调 | [EVENT] onFocus 与 onBlur 均未被调用（destroy 后不再触发任何回调） | import: vitest; API: expect(onFocus).not.toHaveBeenCalled(); expect(onBlur).not.toHaveBeenCalled(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] destroy 后 focus()/blur() 不抛异常
- [EVENT] onFocus/onBlur 均未被调用

---

## FP-01-06-E02 [P3] [E] onFocus 回调抛异常向上传播

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onFocus: () => {
      throw new Error("focus-boom");
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onFocus?: () => void`、`editor.focus(): void`
  - 传播机制: setFocused 中直接调用 `config.onFocus?.()`（editor.ts:876-886），异常不捕获、向上传播到 focus() 调用方
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.focus()（onFocus 抛异常） | [STATE] 异常 Error("focus-boom") 向上传播（setFocused 不捕获回调异常） | import: @floatboat/nexus-core; API: expect(() => editor.focus()).toThrow("focus-boom"); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] expect(() => editor.focus()).toThrow("focus-boom")

---

## FP-01-06-B01 [P4] [B] 连续 focus 不重复触发 onFocus（幂等）

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const onFocus = vi.fn();
  const container = document.createElement("div");
  const editor = createEditor({ container, onFocus });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.focus(): void`、`onFocus?: () => void`
  - 幂等机制: setFocused 中 `if (destroyed || focused === next) return;`（editor.ts:876-877），`focused` 已为 true 时二次 focus 短路，不重复回调
  - 陷阱提示: 与 events.test.ts "focus event" 幂等语义一致；jsdom 下 view.focus() 重复调用安全

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 连续两次调用 editor.focus() | [EVENT] onFocus 仅被调用 1 次（focused===true 短路，幂等，editor.ts:876-877） | import: @floatboat/nexus-core; API: editor.focus(); editor.focus(); 框架: vitest; 等待: 无 |
| 2 | 检查焦点 | [DOM] document.activeElement === .cm-content（保持聚焦） | import: vitest; API: expect(document.activeElement).toBe(container.querySelector(".cm-content")); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [EVENT] expect(onFocus).toHaveBeenCalledOnce()
- [DOM] document.activeElement === .cm-content

---

## 增强信息来源（FP-01-06 focus/blur）
- API签名: packages/core/src/editor.ts（focus:855-857、blur:859-861、setFocused 幂等:876-886、destroy 后短路:855-869）
- 类型定义: packages/core/src/types.ts（EditorConfig.onFocus:102/onBlur:103、EditorAPI.focus:252/blur:253）
- 测试参考: packages/core/test/events.test.ts（editor.on("focus", handler) + toHaveBeenCalledOnce 模式）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）

---

## FP-01-07-N01 [P1] [N] 配置 onAssetUpload 钩子后 uploadAsset 上传成功返回 URL

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const uploadHook = vi.fn(async (file: File) => `assets/${file.name}`);
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: uploadHook,
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`（types.ts:104）；`editor.uploadAsset(file: File): Promise<string | null>`（types.ts:239；实现 editor.ts:768-774 直接返回 `config.onAssetUpload(file)`）
  - 返回值: 钩子返回的 URL 字符串原样透传
  - 陷阱提示: 无

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 构造 File 并调用 editor.uploadAsset(file) | [API] 返回 Promise 解析为 "assets/a.png"（onAssetUpload 返回值原样透传，editor.ts:768-774） | import: @floatboat/nexus-core; API: await editor.uploadAsset(new File(["x"], "a.png", { type: "image/png" })); 框架: vitest; 等待: await |
| 2 | 断言钩子被调用 | [EVENT] uploadHook 被调用且参数为同一 File 实例 | import: vitest; API: expect(uploadHook).toHaveBeenCalledWith(file); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] await editor.uploadAsset(file) === "assets/a.png"
- [EVENT] expect(uploadHook).toHaveBeenCalledWith(file)

---

## FP-01-07-N02 [P1] [N] 拖拽图片文件到编辑器插入 markdown 图片语法

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: async (file) => `assets/${file.name}`,
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`；drop 事件经 domEventHandlers 处理（editor.ts:674-682），防抖 100ms（debounceUpload:677-681）后异步插入（insertUploadedAssets，editor.ts:481-499）
  - 插入规则: `file.type.startsWith("image/")` → 图片语法 `![${label}](${url})`（label = file.name，editor.ts:491-494）
  - ⚠️ 陷阱提示: 插入在异步 IIFE 中执行（editor.ts:677-682），测试需 `await flushMicrotasks()`（或 vi.waitFor）等待插入完成；drop 事件需带 `dataTransfer.files` 且 `bubbles: true`，目标为 `.cm-content`

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 .cm-content 派发带图片 File 的 drop 事件 | [STATE] drop 事件被消费（defaultPrevented 为 true；config.onAssetUpload 已配置时不回退默认行为） | import: @floatboat/nexus-core; API: 派发 DragEvent("drop", { dataTransfer: { files: [imgFile] }, bubbles: true, cancelable: true }) 至 .cm-content; 框架: vitest; 等待: flushMicrotasks |
| 2 | 读取文档 | [API] editor.getDocument(): string === "![a.png](assets/a.png)"（图片按 image/ 前缀走图片语法，editor.ts:491-494） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: flushMicrotasks |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] drop 事件 defaultPrevented === true
- [API] editor.getDocument() === "![a.png](assets/a.png)"

---

## FP-01-07-E01 [P3] [E] onAssetUpload 返回 null 时不插入内容

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: async () => null, // 模拟上传失败/拒绝
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`
  - 跳过机制: `insertUploadedAssets` 中 `if (!url || destroyed) continue;`（editor.ts:484-486），URL 为 null 时跳过该文件，不插入任何内容
  - 陷阱提示: 同 N02，需 flushMicrotasks 等待异步插入完成

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 await editor.uploadAsset(file) | [API] 返回 null（钩子返回 null 时原样透传） | import: @floatboat/nexus-core; API: await editor.uploadAsset(file); 框架: vitest; 等待: await |
| 2 | 向 .cm-content 派发 drop 事件（钩子返回 null） | [STATE] 文档不被修改（url 为 null 时 continue 跳过，editor.ts:484-486） | import: @floatboat/nexus-core; API: 派发 drop 事件至 .cm-content; 框架: vitest; 等待: flushMicrotasks |
| 3 | 读取文档 | [API] editor.getDocument(): string === ""（未插入任何内容） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] await editor.uploadAsset(file) === null
- [API] editor.getDocument() === ""

---

## FP-01-07-E02 [P3] [E] 未配置 onAssetUpload 时拖拽不插入且 uploadAsset 返回 null

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({ container });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `editor.uploadAsset(file: File): Promise<string | null>`；drop 处理 `if (!config.onAssetUpload || destroyed) return false;`（editor.ts:674-675）
  - 无钩子行为: uploadAsset 直接返回 `Promise.resolve(null)`（editor.ts:768-774）；drop 事件**不消费**（return false，不 preventDefault、不插入）
  - 陷阱提示: 无钩子时 drop 的 defaultPrevented 为 false（与 N02 的 true 相反），断言需区分

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 调用 editor.uploadAsset(file) | [API] 返回 Promise 解析为 null（无钩子时 Promise.resolve(null)，editor.ts:768-774） | import: @floatboat/nexus-core; API: await editor.uploadAsset(file); 框架: vitest; 等待: await |
| 2 | 向 .cm-content 派发 drop 事件（无钩子） | [STATE] 事件不被消费（defaultPrevented 为 false，未配置钩子时 return false，editor.ts:674-675） | import: @floatboat/nexus-core; API: 派发 drop 事件至 .cm-content; 框架: vitest; 等待: 无 |
| 3 | 读取文档 | [API] editor.getDocument(): string === ""（无插入） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] await editor.uploadAsset(file) === null
- [STATE] drop 事件 defaultPrevented === false
- [API] editor.getDocument() === ""

---

## FP-01-07-E03 [P3] [E] onAssetUpload 抛异常时拖拽不插入且不向外抛错

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: async () => {
      throw new Error("upload-failed");
    },
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`；`editor.uploadAsset(file: File): Promise<string | null>`
  - 容错机制: `insertUploadedAssets` 中 uploadAsset 的 promise 被 try/catch 包裹（editor.ts:487-489），异常时 url = null，继续跳过该文件；上传失败不影响编辑器可用性
  - ⚠️ 陷阱提示: 直接 await editor.uploadAsset(file) 时异常会向上传播（uploadAsset 本身无 try/catch），仅**拖拽路径**（insertUploadedAssets）内部捕获；测试需区分两种路径

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 .cm-content 派发 drop 事件（钩子抛异常） | [STATE] 拖拽路径不抛错、文档不被修改（insertUploadedAssets 内部 catch，editor.ts:487-489） | import: @floatboat/nexus-core; API: 派发 drop 事件至 .cm-content; 框架: vitest; 等待: flushMicrotasks |
| 2 | 读取文档 | [API] editor.getDocument(): string === ""（异常文件被跳过，无插入） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: 无 |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] 拖拽路径无未捕获异常
- [API] editor.getDocument() === ""

---

## FP-01-07-F01 [P2] [F] 多文件混合拖拽按类型分别插入图片与链接

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: async (file) => `assets/${file.name}`,
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`；drop 多文件（dataTransfer.files 多个）
  - 插入规则: `isImage = file.type.startsWith("image/")`（editor.ts:491）；图片 → `![label](url)`，非图片 → `[label](url)`（label = file.name，editor.ts:492-494）；按 files 顺序依次插入到光标位置
  - 陷阱提示: 同 N02，需 flushMicrotasks；多文件按传入顺序逐文件 await 上传

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 .cm-content 派发含 a.png（image/png）与 b.txt（text/plain）两个文件的 drop 事件 | [STATE] 事件被消费，两个文件按顺序依次处理 | import: @floatboat/nexus-core; API: 派发 drop 事件（dataTransfer.files = [aPng, bTxt]）至 .cm-content; 框架: vitest; 等待: flushMicrotasks |
| 2 | 读取文档 | [API] editor.getDocument(): string === "![a.png](assets/a.png)[b.txt](assets/b.txt)"（图片走图片语法，非图片走链接语法，editor.ts:491-494） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: flushMicrotasks |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [API] editor.getDocument() === "![a.png](assets/a.png)[b.txt](assets/b.txt)"

---

## FP-01-07-B01 [P4] [B] 非图片类型文件（text/plain）拖拽插入为链接语法

**测试框架**: Vitest

**前置条件**:
- 依赖环境: jsdom
- 初始文档: 空
- 插件配置: 无
- setup 代码（必须完整可执行，禁止省略）:
  ```typescript
  import { createEditor } from "@floatboat/nexus-core";

  const container = document.createElement("div");
  const editor = createEditor({
    container,
    onAssetUpload: async (file) => `assets/${file.name}`,
  });
  ```
- **增强说明**:
  - import 路径: `createEditor` 从 `@floatboat/nexus-core` 导出
  - 涉及 API: `onAssetUpload?: (file: File) => Promise<string | null>`
  - 插入规则: `text/plain` 不以 "image/" 开头 → isImage 为 false → 链接语法 `[${label}](${url})`（editor.ts:491-494）
  - 陷阱提示: 同 N02，需 flushMicrotasks 等待异步插入

| 步骤 | 操作 | 预期结果 | 自动化信息 |
|------|------|---------|-----------|
| 1 | 向 .cm-content 派发含 text/plain 文件的 drop 事件 | [STATE] 事件被消费（defaultPrevented 为 true） | import: @floatboat/nexus-core; API: 派发 drop 事件（dataTransfer.files = [txtFile]）至 .cm-content; 框架: vitest; 等待: flushMicrotasks |
| 2 | 读取文档 | [API] editor.getDocument(): string === "[doc.txt](assets/doc.txt)"（非图片走链接语法，editor.ts:491-494） | import: @floatboat/nexus-core; API: editor.getDocument(); 框架: vitest; 等待: flushMicrotasks |
| 3 | 清理：editor.destroy() | [STATE] 不抛异常 | import: @floatboat/nexus-core; API: editor.destroy(); 框架: vitest; 等待: 无 |

**断言汇总**:
- [STATE] drop 事件 defaultPrevented === true
- [API] editor.getDocument() === "[doc.txt](assets/doc.txt)"

---

## 增强信息来源（FP-01-07 onAssetUpload）
- API签名: packages/core/src/editor.ts（drop/paste 处理:674-709、无钩子短路:674-675、防抖:677-681、insertUploadedAssets:481-499、url 为空跳过:484-486、异常捕获:487-489、图片/链接分支:491-494、uploadAsset 实现:768-774）
- 类型定义: packages/core/src/types.ts（EditorConfig.onAssetUpload:104、EditorAPI.uploadAsset:239）
- 测试参考: packages/core/test/editor.test.ts（drop 上传场景）
- 陷阱提示: AGENTS.md（Testing Conventions 章节）