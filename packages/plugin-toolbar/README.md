# 工具栏插件与可选模板命令

`@floatboat/nexus-plugin-toolbar` 提供现有格式化 helper、工具栏 UI、插件生命周期入口，以及显式启用的模板命令。新增模板不会改变 `createToolbarPlugin()` 的按钮、命令或默认快捷键。

## 显式启用模板

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createTemplateCommandsPlugin, createToolbarPlugin } from "@floatboat/nexus-plugin-toolbar";

const editor = createEditor({
  container,
  multiCursor: true,
  plugins: [createHistoryPlugin(), createToolbarPlugin(), createTemplateCommandsPlugin()],
});
editor.runCommand("template:insert-table");
```

四个命令分别是 `template:insert-table`、`template:insert-math-block`、`template:insert-inline-math`、`template:insert-mermaid`。插件不注册工具栏按钮、slash 菜单或快捷键；宿主可以自行选择入口。

也可以直接调用 `insertTable(editor)`、`insertMathBlock(editor)`、`insertInlineMath(editor)`、`insertMermaid(editor)`，成功返回 `true`，不可执行或事务被拒绝返回 `false`。这些 helper 只操作显式传入的来源 editor，不读取浏览器 DOM 选区。

## 原子性与安全边界

- 一次读取 `getSelections()` 的全部选区，同一事务替换并设置各自的占位选区，保留原主选区身份。反向选区同样支持。
- 事务使用 `history: "isolate"`；安装 history 支持时，一次 undo 撤销整个模板操作，不合并此前无关输入。模板插件本身不隐式安装撤销扩展。
- 只读、IME 或活动表格/鼠标交互期间拒绝插入，不提交待编辑表格、不打断输入。缺少只读查询或必要事务/交互方法的旧 EditorAPI 也安全拒绝，不回退到 `setDocument`。
- 表格对反斜线、`|` 和换行进行转义；块模板补足空行，相邻选区的模板共享分隔空行。
- Mermaid 围栏比所选内容中的最长连续反引号更长，避免选中文本提前闭合围栏。占位选区由模板内偏移决定，不会误选 `mermaid` 语言标签。
- 公式模板保留所选 TeX 源文本，空选区使用默认表达式；插入不新增或自动启用数学/Mermaid 渲染能力。
- 成功插入后聚焦来源 editor；事务过滤器拒绝时不强制聚焦。

所有新增行为均按需启用，现有格式化 helper 和 UI 保持原有契约。
